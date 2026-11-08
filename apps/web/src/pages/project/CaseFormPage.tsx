import {
  CASE_PRIORITIES,
  createCaseBody,
  type CasePriority,
  type ManualCaseDto,
  type ProjectDto,
  type SuiteDto,
} from "@testpulse/shared";
import { ArrowLeft, ClipboardList, Loader2, LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AutomationLink, type LinkedTest } from "@/components/AutomationLink";
import { BugLabelsInput } from "@/components/BugLabelsInput";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { FormField } from "@/components/FormField";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { MarkdownEditor, type EditorMode } from "@/components/MarkdownEditor";
import { NativeSelect } from "@/components/NativeSelect";
import { modeKey, StepEditor } from "@/components/StepEditor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { addLabels, normalizeErrorKey } from "@/lib/bugForm";
import { focusField, serverErrorToForm, useDocumentTitle } from "@/lib/forms";
import { caseCode, CASE_PRIORITY_LABEL, parseCaseNumber } from "@/lib/manual";
import { addStep, stepErrors, toCaseSteps, toStepDrafts, type StepDraft } from "@/lib/manualSteps";
import { loginPathFor } from "@/lib/navigation";
import { useLoad } from "@/lib/useLoad";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCALAR_FIELDS = ["suiteId", "title", "preconditions", "priority", "automatedTestId"] as const;

const FIELD_ORDER = ["suiteId", "title", "preconditions", "priority", "labels"] as const;
const STEP_FIELD = /^steps\.(\d+)\.(action|expected)$/;

/** Urutan kemunculan kolom di formulir (dipakai untuk menentukan kolom bermasalah yang difokuskan lebih dulu). */
function fieldRank(key: string): number {
  const fixed = FIELD_ORDER.indexOf(key as (typeof FIELD_ORDER)[number]);
  if (fixed >= 0) return fixed;
  const step = STEP_FIELD.exec(key);
  if (step) return FIELD_ORDER.length + Number(step[1]) * 2 + (step[2] === "expected" ? 1 : 0);
  // `steps` (jumlah langkah) dan kunci lain: setelah semua langkah; `automatedTestId` paling akhir.
  return key === "automatedTestId" ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1;
}

/** `/p/:slug/cases/new?suite=` dan `/p/:slug/cases/:number/edit`: formulir case dengan editor langkah dan tautan otomasi. */
export function CaseFormPage() {
  const { slug = "", number } = useParams();
  return (
    <ProjectFrame slug={slug} title={number === undefined ? "Buat case" : `Edit TC-${number}`} tab="manual">
      {(project) => <FormGate project={project} number={number === undefined ? undefined : parseCaseNumber(number)} />}
    </ProjectFrame>
  );
}

function FormGate({ project, number }: { project: ProjectDto; number: number | null | undefined }) {
  const { pathname, search } = useLocation();
  const canWrite = project.myRole === "tester" || project.myRole === "admin";
  if (!canWrite) {
    return (
      <EmptyState icon={LockKeyhole} title="Tidak bisa mengubah test case" headingLevel="h1" data-testid="case-form-forbidden">
        <p>
          {project.myRole === "viewer"
            ? "Peran viewer hanya bisa melihat test case. Minta admin project mengubah peranmu menjadi tester untuk menulis case."
            : "Hanya tester dan admin project ini yang bisa menulis test case. Masuk dengan akun anggota untuk melanjutkan."}
        </p>
        {project.myRole === null ? (
          <Link to={loginPathFor(`${pathname}${search}`)} className={INLINE_LINK_CLASS}>
            Masuk
          </Link>
        ) : null}
      </EmptyState>
    );
  }
  return <FormLoader key={`${project.slug}:${number ?? "new"}`} slug={project.slug} number={number} />;
}

interface FormSource {
  suites: SuiteDto[];
  /** Case yang diedit; `null` untuk case baru. */
  existing: ManualCaseDto | null;
}

/**
 * Memuat suite (dan case yang diedit) lebih dulu, baru memasang formulir: `<select>` suite dibuat dari pembaruan state
 * biasa setelah data siap, bukan di dalam subtree Suspense/transition yang baru dibuka (artefak guard CSP WebKit; lihat BugNewPage).
 */
function FormLoader({ slug, number }: { slug: string; number: number | null | undefined }) {
  const [params] = useSearchParams();
  const editing = number !== undefined;
  // Berapa kali case dimuat ulang setelah konflik; formulir baru memfokuskan judulnya agar fokus tidak hilang bersama banner.
  const [reloads, setReloads] = useState(0);
  const fetchSource = useCallback(async (): Promise<FormSource> => {
    if (number === null) throw new ApiError(404, "CASE_NOT_FOUND", "Case tidak ditemukan");
    const [suites, existing] = await Promise.all([
      api.manual.suites.list(slug),
      number === undefined ? Promise.resolve(null) : api.manual.cases.get(slug, number),
    ]);
    return { suites, existing };
  }, [slug, number]);
  const load = useLoad(fetchSource);

  if (load.state === "loading") return <Loading label={editing ? "Memuat case…" : "Menyiapkan formulir…"} />;
  if (load.state === "error") {
    if (load.error instanceof ApiError && load.error.code === "CASE_NOT_FOUND") {
      return (
        <EmptyState icon={ClipboardList} title="Case tidak ditemukan" headingLevel="h1" data-testid="case-not-found">
          <p>Case ini tidak ada di project ini, atau sudah dihapus.</p>
          <Link to={`/p/${encodeURIComponent(slug)}/cases`} className={BACK_LINK_CLASS}>
            Ke daftar case
          </Link>
        </EmptyState>
      );
    }
    return <LoadError error={load.error} fallback="Gagal memuat formulir case. Coba lagi." onRetry={load.reload} />;
  }

  const { suites, existing } = load.data;
  if (suites.length === 0) {
    return (
      <EmptyState icon={ClipboardList} title="Buat suite lebih dulu" headingLevel="h1" data-testid="case-form-no-suite">
        <p>Setiap test case berada di sebuah suite. Tambahkan suite di halaman test case, lalu kembali ke sini.</p>
        <Link to={`/p/${encodeURIComponent(slug)}/cases`} className={BACK_LINK_CLASS}>
          Ke daftar case
        </Link>
      </EmptyState>
    );
  }

  const requested = params.get("suite");
  const initialSuite = requested !== null && UUID.test(requested) && suites.some((s) => s.id === requested) ? requested : undefined;
  return (
    <CaseForm
      slug={slug}
      suites={suites}
      existing={existing}
      defaultSuiteId={initialSuite ?? suites[0]!.id}
      focusTitle={reloads > 0}
      onReload={() => {
        setReloads((n) => n + 1);
        load.reload();
      }}
    />
  );
}

interface CaseFormProps {
  slug: string;
  suites: SuiteDto[];
  existing: ManualCaseDto | null;
  defaultSuiteId: string;
  focusTitle: boolean;
  /** Memuat ulang case dari server (setelah konflik); isian yang belum tersimpan dibuang. */
  onReload: () => void;
}

function CaseForm({ slug, suites, existing, defaultSuiteId, focusTitle, onReload }: CaseFormProps) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [suiteId, setSuiteId] = useState(existing?.suite.id ?? defaultSuiteId);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [preconditions, setPreconditions] = useState(existing?.preconditions ?? "");
  const [preconditionsMode, setPreconditionsMode] = useState<EditorMode>("write");
  const [priority, setPriority] = useState<CasePriority>(existing?.priority ?? "medium");
  const [labels, setLabels] = useState<string[]>(existing?.labels ?? []);
  const [labelDraft, setLabelDraft] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>(() => (existing ? toStepDrafts(existing.steps) : addStep([])));
  const [modes, setModes] = useState<Record<string, EditorMode>>({});
  const [automatedTest, setAutomatedTest] = useState<LinkedTest | null>(
    existing?.automatedTest ? { id: existing.automatedTest.id, suite: existing.automatedTest.suite, name: existing.automatedTest.name } : null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const suiteFieldId = useId();
  const code = existing ? caseCode(existing.number) : null;
  useDocumentTitle(code ? `Edit ${code} · ${existing!.title}` : "Buat case");

  useEffect(() => {
    if (focusTitle) formRef.current?.querySelector<HTMLInputElement>('[name="title"]')?.focus();
  }, [focusTitle]);

  function fail(unordered: Record<string, string>, message: string | null) {
    // Urutan kunci menentukan field yang menerima fokus: yang paling atas di formulir lebih dulu.
    const fields = Object.fromEntries(Object.entries(unordered).sort(([a], [b]) => fieldRank(a) - fieldRank(b)));
    setFieldErrors(fields);
    setFormError(message);
    // Kolom Markdown tersembunyi saat pratinjau dan tidak bisa difokus: kembali ke Tulis dulu (sinkron) sebelum memfokuskan.
    flushSync(() => {
      if (fields.preconditions) setPreconditionsMode("write");
      setModes((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(fields)) {
          const match = STEP_FIELD.exec(key);
          const step = match ? steps[Number(match[1])] : undefined;
          if (step) delete next[modeKey(step, match![2] as "action" | "expected")];
        }
        return next;
      });
    });
    focusField(formRef.current, fields);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Teks label yang belum jadi chip: yang valid ikut terkirim, yang tidak valid menahan penyimpanan dengan pesannya.
    const pendingLabels = addLabels(labels, labelDraft.split(","));
    const parsed = createCaseBody.safeParse({
      suiteId,
      title,
      preconditions,
      steps: toCaseSteps(steps),
      priority,
      labels: pendingLabels.labels,
      automatedTestId: automatedTest?.id ?? null,
    });
    if (!parsed.success || pendingLabels.error) {
      const fields: Record<string, string> = {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = normalizeErrorKey(issue.path.map(String).join(".") || "form");
          fields[key] ??= issue.message;
        }
      }
      if (pendingLabels.error) fields.labels = pendingLabels.error;
      return fail(fields, null);
    }

    setLabels(pendingLabels.labels);
    setLabelDraft("");
    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const saved = existing
        ? await api.manual.cases.update(slug, existing.number, { ...parsed.data, version: existing.version })
        : await api.manual.cases.create(slug, parsed.data);
      navigate(`/p/${encodeURIComponent(slug)}/cases/${saved.number}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "CASE_CONFLICT") {
        // Isian tetap di formulir (tidak dibuang); pengguna memutuskan kapan memuat ulang.
        setConflict(true);
        setFieldErrors({});
        setFormError(null);
        return;
      }
      if (err instanceof ApiError && err.code === "CASE_NOT_FOUND") return fail({}, "Case ini sudah dihapus orang lain.");
      const serverKeys = err instanceof ApiError ? Object.keys(err.fields ?? {}) : [];
      const known = serverKeys.filter(
        (key) => (SCALAR_FIELDS as readonly string[]).includes(key) || /^(steps|labels)(\.|$)/.test(key),
      );
      const mapped = serverErrorToForm(err, known);
      const fields: Record<string, string> = {};
      for (const [key, message] of Object.entries(mapped.fields)) fields[normalizeErrorKey(key)] ??= message;
      fail(fields, mapped.message);
    }
  }

  function reload() {
    setReloading(true);
    onReload();
  }

  const backTo = existing
    ? `/p/${encodeURIComponent(slug)}/cases/${existing.number}`
    : `/p/${encodeURIComponent(slug)}/cases`;
  const errors = stepErrors(fieldErrors);

  return (
    <section aria-labelledby="case-form-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-3">
        <Link to={backTo} className={BACK_LINK_CLASS} data-testid="case-form-back">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{existing ? `${code} ${existing.title}` : "Daftar case"}</span>
        </Link>
        <h1 id="case-form-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {existing ? `Edit ${code}` : "Buat test case"}
        </h1>
        {conflict ? (
          <div
            role="alert"
            data-testid="case-conflict"
            className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <div className="grid gap-1">
              <p className="m-0 font-semibold">Case ini baru saja diubah orang lain</p>
              <p className="m-0">
                Isianmu di bawah belum dibuang, jadi bagian yang perlu bisa disalin dulu. Muat ulang untuk melihat versi terbaru;
                perubahan yang belum tersimpan akan dibuang.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={reloading} onClick={reload} data-testid="case-conflict-reload">
              {reloading ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Muat ulang case
            </Button>
          </div>
        ) : null}
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid min-w-0 gap-5" data-testid="case-form">
        <FormError message={formError} />
        <div className="grid min-w-0 gap-1.5 [&>span]:w-full">
          <Label htmlFor={suiteFieldId}>Suite</Label>
          <NativeSelect
            id={suiteFieldId}
            name="suiteId"
            value={suiteId}
            data-testid="case-suite"
            aria-invalid={fieldErrors.suiteId ? true : undefined}
            aria-describedby={fieldErrors.suiteId ? `${suiteFieldId}-error` : undefined}
            onChange={(e) => setSuiteId(e.target.value)}
            className="w-full"
          >
            {suites.some((suite) => suite.id === suiteId) ? null : <option value={suiteId}>{existing?.suite.name ?? "Pilih suite"}</option>}
            {suites.map((suite) => (
              <option key={suite.id} value={suite.id}>
                {suite.name}
              </option>
            ))}
          </NativeSelect>
          {fieldErrors.suiteId ? (
            <p id={`${suiteFieldId}-error`} className="text-sm font-medium text-destructive" data-testid="field-error-suiteId">
              {fieldErrors.suiteId}
            </p>
          ) : null}
        </div>
        <FormField name="title" label="Judul" value={title} onChange={setTitle} error={fieldErrors.title} testIdPrefix="case" />
        <MarkdownEditor
          name="preconditions"
          label="Prasyarat"
          value={preconditions}
          onChange={setPreconditions}
          error={fieldErrors.preconditions}
          mode={preconditionsMode}
          onModeChange={setPreconditionsMode}
          rows={4}
          hint="Mendukung Markdown. Boleh dikosongkan."
          testId="case-preconditions"
        />
        <PriorityField value={priority} onChange={setPriority} error={fieldErrors.priority} />
        <BugLabelsInput
          value={labels}
          onChange={setLabels}
          draft={labelDraft}
          onDraftChange={setLabelDraft}
          error={fieldErrors.labels}
          testIdPrefix="case"
        />
        <StepEditor
          steps={steps}
          onChange={setSteps}
          errors={errors}
          modes={modes}
          onModeChange={(key, mode) => setModes((prev) => ({ ...prev, [key]: mode }))}
        />
        <AutomationLink slug={slug} value={automatedTest} onChange={setAutomatedTest} error={fieldErrors.automatedTestId} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting} data-testid="case-submit">
            {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Simpan case
          </Button>
          <Button asChild variant="outline">
            <Link to={backTo}>Batal</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

function PriorityField({ value, onChange, error }: { value: CasePriority; onChange: (value: CasePriority) => void; error?: string | undefined }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5 sm:max-w-xs [&>span]:w-full">
      <Label htmlFor={id}>Prioritas</Label>
      <NativeSelect
        id={id}
        name="priority"
        value={value}
        data-testid="case-priority"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value as CasePriority)}
        className="w-full"
      >
        {CASE_PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {CASE_PRIORITY_LABEL[priority]}
          </option>
        ))}
      </NativeSelect>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive" data-testid="field-error-priority">
          {error}
        </p>
      ) : null}
    </div>
  );
}
