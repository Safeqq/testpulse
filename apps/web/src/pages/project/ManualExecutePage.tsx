import {
  MANUAL_RESULT_STATUSES,
  STEP_RESULT_STATUSES,
  suggestStatus,
  updateRunCaseBody,
  type ManualResultStatus,
  type ManualRunDto,
  type MemberDto,
  type ProjectDto,
  type RunCaseDto,
  type StepResult,
  type StepResultStatus,
} from "@testpulse/shared";
import { Bug as BugIcon, ClipboardList, Loader2, Save, SkipForward } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { BugBadge } from "@/components/BugBadge";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { LazyMarkdown } from "@/components/LazyMarkdown";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { ManualStatus } from "@/components/ManualStatus";
import { MarkdownEditor, type EditorMode } from "@/components/MarkdownEditor";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { focusField, useDocumentTitle } from "@/lib/forms";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { CASE_PRIORITY_LABEL, caseCode, MANUAL_STATUS_LABEL, parseRunNumber, runCode, type RunLocationState } from "@/lib/manual";
import { useLoad } from "@/lib/useLoad";
import { preloadPages } from "./lazyPages";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

/** State navigasi antarhalaman eksekusi: "Simpan & lanjut" memindahkan fokus ke judul case berikutnya. */
interface ExecuteLocationState {
  focusTitle?: boolean;
}

/**
 * `/p/:slug/manual-runs/:number/cases/:id`: eksekusi satu case dalam run manual (spec Tahap 4 §8.8): hasil per langkah,
 * saran status (tidak pernah diterapkan sendiri), catatan, assignee, simpan & lanjut, serta laporan bug dari case gagal.
 */
export function ManualExecutePage() {
  const { slug = "", number, id = "" } = useParams();
  const runNumber = number === undefined ? null : parseRunNumber(number);
  return (
    <ProjectFrame slug={slug} title={runNumber === null ? "Eksekusi case" : `Eksekusi ${runCode(runNumber)}`} tab="manual">
      {(project) => <ExecuteLoader key={`${project.slug}:${runNumber}:${id}`} project={project} runNumber={runNumber} id={id} />}
    </ProjectFrame>
  );
}

function ExecuteLoader({ project, runNumber, id }: { project: ProjectDto; runNumber: number | null; id: string }) {
  const { slug } = project;
  const fetchBoth = useCallback(async (): Promise<{ run: ManualRunDto; runCase: RunCaseDto }> => {
    if (runNumber === null) throw new ApiError(404, "MANUAL_RUN_NOT_FOUND", "Run tidak ditemukan");
    const [run, runCase] = await Promise.all([api.manual.runs.get(slug, runNumber), api.manual.runCases.get(slug, runNumber, id)]);
    return { run, runCase };
  }, [slug, runNumber, id]);
  const load = useLoad(fetchBoth);
  const base = `/p/${encodeURIComponent(slug)}`;

  if (load.state === "loading") return <Loading label="Memuat case…" />;
  if (load.state === "error") {
    const code = load.error instanceof ApiError ? load.error.code : null;
    if (code === "MANUAL_RUN_NOT_FOUND" || code === "RUN_CASE_NOT_FOUND") {
      const runKnown = code === "RUN_CASE_NOT_FOUND" && runNumber !== null;
      return (
        <EmptyState icon={ClipboardList} title="Case tidak ditemukan" headingLevel="h1" data-testid="exec-not-found">
          <p>{runKnown ? "Case ini tidak ada di run ini." : "Run ini tidak ada di project ini, atau sudah dihapus."}</p>
          <Link to={runKnown ? `${base}/manual-runs/${runNumber}` : `${base}/manual-runs`} className={BACK_LINK_CLASS}>
            {runKnown ? `Ke ${runCode(runNumber)}` : "Ke daftar run"}
          </Link>
        </EmptyState>
      );
    }
    return <LoadError error={load.error} fallback="Gagal memuat case. Coba lagi." onRetry={load.reload} />;
  }
  return (
    <ExecuteView
      slug={slug}
      canWrite={project.myRole === "tester" || project.myRole === "admin"}
      run={load.data.run}
      initial={load.data.runCase}
    />
  );
}

interface Draft {
  status: ManualResultStatus;
  stepResults: StepResult[];
  note: string;
  /** "" = belum di-assign. */
  assigneeId: string;
}

function draftFrom(item: RunCaseDto): Draft {
  return {
    status: item.status,
    // Server menjamin panjangnya sama dengan langkah; dilengkapi bila tidak, agar setiap langkah punya isian.
    stepResults: item.steps.map((_, index) => item.stepResults[index] ?? { status: null, note: "" }),
    note: item.note,
    assigneeId: item.assignee?.id ?? "",
  };
}

/** Run case diubah orang lain (`MANUAL_RUN_CONFLICT`) atau run-nya diselesaikan selagi halaman terbuka (`RUN_COMPLETED`). */
type Clash = "changed" | "completed";

/** Field yang punya kontrol sendiri di formulir; galat lain tampil sebagai galat umum. */
const KNOWN_FIELD = /^(note|assigneeId|stepResults\.\d+\.note)$/;

function ExecuteView({ slug, canWrite, run, initial }: { slug: string; canWrite: boolean; run: ManualRunDto; initial: RunCaseDto }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const [clash, setClash] = useState<Clash | null>(null);
  const [saving, setSaving] = useState<"save" | "next" | null>(null);
  const [reloading, setReloading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [noteMode, setNoteMode] = useState<EditorMode>("write");
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const base = `/p/${encodeURIComponent(slug)}`;
  const runPath = `${base}/manual-runs/${run.number}`;
  const code = caseCode(item.caseNumber);
  const completedOnServer = item.runStatus === "completed";
  // Hanya-baca: bukan tester/admin, run sudah selesai, atau diketahui selesai di tempat lain. Isian tetap terlihat.
  const readOnly = !canWrite || completedOnServer || clash === "completed";
  const suggestion = suggestStatus(draft.stepResults);
  const [focusTitle] = useState(() => Boolean((location.state as ExecuteLocationState | null)?.focusTitle));
  useDocumentTitle(`${code} · ${item.title}`);

  useEffect(() => preloadPages("bugNew", "manualRun"), []);

  // Datang dari "Simpan & lanjut": tombol yang diklik sudah hilang, jadi fokus pindah ke judul case berikutnya.
  useEffect(() => {
    if (focusTitle) headingRef.current?.focus();
  }, [focusTitle]);

  function change(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setSaved(false);
  }

  function changeStep(index: number, next: Partial<StepResult>) {
    setDraft((current) => ({
      ...current,
      stepResults: current.stepResults.map((result, i) => (i === index ? { ...result, ...next } : result)),
    }));
    setSaved(false);
  }

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    // Textarea catatan tersembunyi saat pratinjau dan tidak bisa difokus: kembali ke Tulis dulu (sinkron).
    if (fields.note) flushSync(() => setNoteMode("write"));
    focusField(formRef.current, fields);
  }

  async function save(andNext: boolean) {
    if (saving || readOnly) return;
    const body = {
      version: item.version,
      status: draft.status,
      stepResults: draft.stepResults,
      note: draft.note,
      assigneeId: draft.assigneeId === "" ? null : draft.assigneeId,
    };
    const parsed = updateRunCaseBody.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.map(String).join(".") || "form"] ??= issue.message;
      const known = Object.fromEntries(Object.entries(fields).filter(([key]) => KNOWN_FIELD.test(key)));
      const other = Object.entries(fields).find(([key]) => !KNOWN_FIELD.test(key));
      return fail(known, other ? other[1] : null);
    }

    setSaving(andNext ? "next" : "save");
    setFieldErrors({});
    setFormError(null);
    setSaved(false);
    try {
      const updated = await api.manual.runCases.update(slug, run.number, item.id, parsed.data);
      setItem(updated);
      setClash(null);
      if (!andNext) {
        setSaved(true);
        setSaving(null);
        return;
      }
      if (updated.nextUntestedId) {
        const state: ExecuteLocationState = { focusTitle: true };
        navigate(`${runPath}/cases/${encodeURIComponent(updated.nextUntestedId)}`, { state });
      } else {
        const state: RunLocationState = { allExecuted: true };
        navigate(runPath, { state });
      }
    } catch (err) {
      setSaving(null);
      if (err instanceof ApiError && err.code === "MANUAL_RUN_CONFLICT") return setClash("changed");
      if (err instanceof ApiError && err.code === "RUN_COMPLETED") return setClash("completed");
      if (err instanceof ApiError && (err.code === "MANUAL_RUN_NOT_FOUND" || err.code === "RUN_CASE_NOT_FOUND")) {
        return fail({}, "Run atau case ini sudah dihapus. Hasil tidak bisa disimpan.");
      }
      const serverFields = err instanceof ApiError ? (err.fields ?? {}) : {};
      const known = Object.fromEntries(Object.entries(serverFields).filter(([key]) => KNOWN_FIELD.test(key)));
      const orphan = Object.entries(serverFields).find(([key]) => !KNOWN_FIELD.test(key));
      const message =
        Object.keys(known).length > 0 ? null : (orphan?.[1] ?? (err instanceof ApiError ? err.message : "Gagal menyimpan hasil. Coba lagi."));
      fail(known, message);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  /** Memuat ulang run case setelah bentrok: isian di sini diganti hasil terbaru dari server. */
  async function reload() {
    setReloading(true);
    try {
      const fresh = await api.manual.runCases.get(slug, run.number, item.id);
      setItem(fresh);
      setDraft(draftFrom(fresh));
      setClash(null);
      setFieldErrors({});
      setFormError(null);
      setSaved(false);
      headingRef.current?.focus();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Gagal memuat ulang case. Coba lagi.");
    } finally {
      setReloading(false);
    }
  }

  return (
    <article aria-labelledby="exec-title" className="grid min-w-0 grid-cols-1 gap-6">
      <nav aria-label="Lokasi case">
        <ol className="m-0 flex min-w-0 list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-sm text-muted-foreground">
          <li className="min-w-0">
            <Link to={`${base}/manual-runs`} className={INLINE_LINK_CLASS}>
              Run manual
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="min-w-0 [overflow-wrap:anywhere]">
            <Link to={runPath} className={INLINE_LINK_CLASS} data-testid="exec-run-link">
              {runCode(run.number)} · {run.name}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="font-mono">
            {code}
          </li>
        </ol>
      </nav>

      <header className="grid min-w-0 gap-3">
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {item.caseId !== null ? (
            <Link to={`${base}/cases/${item.caseNumber}`} className={`${INLINE_LINK_CLASS} font-mono`} data-testid="exec-case-link">
              {code}
            </Link>
          ) : (
            <span className="font-mono">{code}</span>
          )}
          <ManualStatus status={item.status} className="text-sm" />
          {item.executedBy && item.executedAt ? (
            <span className="min-w-0 [overflow-wrap:anywhere]">
              dieksekusi {item.executedBy.name}{" "}
              <time dateTime={item.executedAt} title={formatDateTime(item.executedAt)}>
                {formatRelativeTime(item.executedAt)}
              </time>
            </span>
          ) : null}
        </p>
        <h1
          id="exec-title"
          ref={headingRef}
          tabIndex={-1}
          className="m-0 text-2xl font-semibold tracking-tight outline-hidden [overflow-wrap:anywhere]"
          data-testid="exec-title"
        >
          {item.title}
        </h1>
        <dl className="m-0 flex min-w-0 flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-muted-foreground">Suite</dt>
            <dd className="m-0 min-w-0 font-medium [overflow-wrap:anywhere]" data-testid="exec-suite">
              {item.suiteName}
            </dd>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-muted-foreground">Prioritas</dt>
            <dd className="m-0 font-medium" data-testid="exec-priority">
              {CASE_PRIORITY_LABEL[item.priority]}
            </dd>
          </div>
        </dl>
        {item.caseId === null ? (
          <p className="m-0 text-xs text-muted-foreground" data-testid="exec-case-deleted">
            Case asli sudah dihapus; ini salinan saat run dibuat.
          </p>
        ) : null}
        {completedOnServer ? (
          <p className="m-0 rounded-md border bg-muted/50 px-3 py-2 text-sm" data-testid="exec-completed">
            Run ini sudah diselesaikan. Hasilnya hanya bisa dibaca{canWrite ? " sampai run dibuka ulang" : ""}.
          </p>
        ) : null}
        <BugArea slug={slug} runNumber={run.number} item={item} canWrite={canWrite} />
      </header>

      <section aria-labelledby="exec-preconditions-title" className="grid min-w-0 gap-2">
        <h2 id="exec-preconditions-title" className="m-0 text-lg font-semibold tracking-tight">
          Prasyarat
        </h2>
        <div className="min-w-0" data-testid="exec-preconditions">
          {item.preconditions.trim() === "" ? (
            <p className="m-0 text-sm text-muted-foreground">Tidak ada prasyarat.</p>
          ) : (
            <LazyMarkdown source={item.preconditions} />
          )}
        </div>
      </section>

      <form ref={formRef} onSubmit={submit} noValidate className="grid min-w-0 grid-cols-1 gap-6" aria-label={`Hasil eksekusi ${code}`}>
        <section aria-labelledby="exec-steps-title" className="grid min-w-0 gap-3">
          <h2 id="exec-steps-title" className="m-0 text-lg font-semibold tracking-tight">
            Langkah <span className="text-sm font-normal text-muted-foreground">({item.steps.length})</span>
          </h2>
          <ol className="m-0 grid min-w-0 list-none gap-3 p-0">
            {item.steps.map((step, index) => (
              <li key={index} className="min-w-0" data-testid={`exec-step-${index}`}>
                <StepCard
                  index={index}
                  action={step.action}
                  expected={step.expected}
                  result={draft.stepResults[index] ?? { status: null, note: "" }}
                  readOnly={readOnly}
                  noteError={fieldErrors[`stepResults.${index}.note`]}
                  onChange={(next) => changeStep(index, next)}
                />
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="exec-result-title" className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 text-card-foreground">
          <h2 id="exec-result-title" className="m-0 text-lg font-semibold tracking-tight">
            Hasil case
          </h2>
          <RadioGroup
            legend="Status case"
            name="status"
            options={MANUAL_RESULT_STATUSES}
            value={draft.status}
            disabled={readOnly}
            onChange={(status) => change({ status })}
            testId="exec-status"
          />
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-testid="exec-suggestion">
            <p role="status" className="m-0 min-w-0 text-sm">
              {suggestion ? (
                <>
                  Saran dari hasil langkah: <span className="font-semibold">{MANUAL_STATUS_LABEL[suggestion]}</span>
                  {suggestion === draft.status ? " (sudah dipilih)" : ""}
                </>
              ) : (
                <span className="text-muted-foreground">Belum ada saran: isi hasil setiap langkah.</span>
              )}
            </p>
            {suggestion && suggestion !== draft.status && !readOnly ? (
              <Button type="button" variant="outline" size="sm" onClick={() => change({ status: suggestion })} data-testid="exec-use-suggestion">
                Pakai saran: {MANUAL_STATUS_LABEL[suggestion]}
              </Button>
            ) : null}
          </div>
          <MarkdownEditor
            name="note"
            label="Catatan case"
            value={draft.note}
            onChange={(note) => change({ note })}
            error={fieldErrors.note}
            hint="Mendukung Markdown. Boleh dikosongkan."
            testId="exec-note"
            rows={4}
            mode={noteMode}
            onModeChange={setNoteMode}
            readOnly={readOnly}
          />
          <AssigneeField
            slug={slug}
            canWrite={canWrite}
            editable={canWrite && !completedOnServer}
            disabled={readOnly}
            current={item.assignee}
            value={draft.assigneeId}
            error={fieldErrors.assigneeId}
            onChange={(assigneeId) => change({ assigneeId })}
          />
        </section>

        <div className="grid min-w-0 gap-3">
          <FormError message={formError} />
          {clash === "changed" ? (
            <Banner testId="exec-conflict" title="Case ini baru saja disimpan orang lain">
              <p className="m-0">Muat ulang untuk melihat hasil terbaru. Isian di halaman ini akan diganti hasil tersebut.</p>
              <Button type="button" variant="outline" size="sm" disabled={reloading} onClick={() => void reload()} data-testid="exec-conflict-reload">
                {reloading ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
                Muat ulang case
              </Button>
            </Banner>
          ) : null}
          {clash === "completed" ? (
            <Banner testId="exec-completed" title="Run ini sudah diselesaikan">
              <p className="m-0">
                Hasil belum tersimpan dan formulir kini hanya-baca. Isianmu tetap terlihat di atas; salin bila perlu, lalu buka ulang
                run untuk menyimpannya.
              </p>
              <Link to={runPath} className={INLINE_LINK_CLASS}>
                Ke detail {runCode(run.number)}
              </Link>
            </Banner>
          ) : null}
          {saved ? (
            <p role="status" className="m-0 text-sm text-muted-foreground" data-testid="exec-saved">
              Hasil tersimpan.
            </p>
          ) : null}
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving !== null || clash !== null} data-testid="exec-save">
                {saving === "save" ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                Simpan
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving !== null || clash !== null}
                onClick={() => void save(true)}
                data-testid="exec-save-next"
              >
                {saving === "next" ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <SkipForward aria-hidden="true" />}
                Simpan & lanjut
              </Button>
            </div>
          ) : null}
        </div>
      </form>
    </article>
  );
}

function Banner({ testId, title, children }: { testId: string; title: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <p className="m-0 font-semibold">{title}</p>
      {children}
    </div>
  );
}

/**
 * Bug dari case ini (spec §8.8 butir 6): badge bila sudah ada bug tertaut (non-`closed`), atau "Laporkan bug" untuk case
 * yang tersimpan `failed`. Laporan tetap bisa dibuat walau run sudah selesai (spec §4.4).
 */
function BugArea({ slug, runNumber, item, canWrite }: { slug: string; runNumber: number; item: RunCaseDto; canWrite: boolean }) {
  if (item.bugs.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="exec-bugs">
        <span className="text-sm text-muted-foreground">Bug:</span>
        {item.bugs.map((bug) => (
          <BugBadge key={bug.number} bug={bug} slug={slug} />
        ))}
      </div>
    );
  }
  if (!canWrite || item.status !== "failed") return null;
  const query = new URLSearchParams({ manualRun: String(runNumber), manualRunCase: item.id });
  return (
    <div>
      <Button asChild variant="outline" size="sm">
        <Link to={`/p/${encodeURIComponent(slug)}/bugs/new?${query.toString()}`} data-testid="exec-report-bug">
          <BugIcon aria-hidden="true" />
          Laporkan bug
        </Link>
      </Button>
    </div>
  );
}

/** Satu langkah: aksi, hasil yang diharapkan, pilihan hasil (radio native dalam fieldset "Langkah n"), dan catatannya. */
function StepCard({
  index,
  action,
  expected,
  result,
  readOnly,
  noteError,
  onChange,
}: {
  index: number;
  action: string;
  expected: string;
  result: StepResult;
  readOnly: boolean;
  noteError: string | undefined;
  onChange: (next: Partial<StepResult>) => void;
}) {
  const noteId = useId();
  const errorId = `${noteId}-error`;
  const label = `Langkah ${index + 1}`;
  return (
    <div className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 text-card-foreground">
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="grid min-w-0 content-start gap-1.5">
          <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label} · Aksi</p>
          <div className="min-w-0">
            <LazyMarkdown source={action} />
          </div>
        </div>
        <div className="grid min-w-0 content-start gap-1.5">
          <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Hasil yang diharapkan</p>
          <div className="min-w-0">
            {expected.trim() === "" ? <p className="m-0 text-sm text-muted-foreground">–</p> : <LazyMarkdown source={expected} />}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
        <RadioGroup
          legend={label}
          name={`step-${index}`}
          options={STEP_RESULT_STATUSES}
          value={result.status}
          disabled={readOnly}
          onChange={(status) => onChange({ status })}
        />
        {result.status !== null && !readOnly ? (
          <Button type="button" variant="ghost" size="sm" aria-label={`Kosongkan hasil ${label.toLowerCase()}`} onClick={() => onChange({ status: null })}>
            Kosongkan
          </Button>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={noteId}>Catatan {label.toLowerCase()}</Label>
        <textarea
          id={noteId}
          name={`stepResults.${index}.note`}
          value={result.note}
          rows={2}
          readOnly={readOnly}
          aria-invalid={noteError ? true : undefined}
          aria-describedby={noteError ? errorId : undefined}
          data-testid={`exec-step-${index}-note`}
          onChange={(e) => onChange({ note: e.target.value })}
          className="min-h-16 w-full min-w-0 resize-y rounded-md border border-input bg-card px-3 py-2 text-base text-foreground shadow-xs transition-colors outline-hidden read-only:bg-muted/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/30 md:text-sm"
        />
        {noteError ? (
          <p id={errorId} className="m-0 text-sm font-medium text-destructive" data-testid={`field-error-stepResults.${index}.note`}>
            {noteError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Grup radio native dalam `<fieldset>` + `<legend>` (spec §8.8): label teks, bukan warna saja. */
function RadioGroup<T extends ManualResultStatus | StepResultStatus>({
  legend,
  name,
  options,
  value,
  disabled,
  onChange,
  testId,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T | null;
  disabled: boolean;
  onChange: (value: T) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" data-testid={testId}>
      <legend className="mb-2 p-0 text-sm font-semibold">{legend}</legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option}
            htmlFor={`${id}-${option}`}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm has-checked:border-primary has-checked:bg-accent has-checked:font-semibold has-disabled:cursor-default"
          >
            <input
              id={`${id}-${option}`}
              type="radio"
              name={`${id}-${name}`}
              value={option}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
              className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            {MANUAL_STATUS_LABEL[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Assignee run case. Tester/admin di run terbuka memilih dari anggota project (daftar anggota tidak pernah publik);
 * selain itu ditampilkan sebagai teks. Anggota yang tidak (atau belum) ada di daftar tetap ditampilkan sebagai pilihan.
 */
function AssigneeField({
  slug,
  canWrite,
  editable,
  disabled,
  current,
  value,
  error,
  onChange,
}: {
  slug: string;
  canWrite: boolean;
  editable: boolean;
  disabled: boolean;
  current: RunCaseDto["assignee"];
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const fetchMembers = useCallback((): Promise<MemberDto[]> => (canWrite ? api.members.list(slug) : Promise.resolve([])), [slug, canWrite]);
  const members = useLoad(fetchMembers);
  if (!editable) {
    return (
      <p className="m-0 text-sm" data-testid="exec-assignee-text">
        <span className="text-muted-foreground">Assignee: </span>
        <span className="font-medium [overflow-wrap:anywhere]">{current ? current.name : "Belum di-assign"}</span>
      </p>
    );
  }
  const list = members.state === "ready" ? members.data : [];
  const options: [string, string][] = list.map((member) => [member.userId, member.name]);
  if (current && !options.some(([optionValue]) => optionValue === current.id)) options.push([current.id, current.name]);
  return (
    <div className="grid min-w-0 gap-1.5 sm:max-w-xs [&>span]:w-full">
      <Label htmlFor={id}>Assignee</Label>
      <NativeSelect
        id={id}
        name="assigneeId"
        value={value}
        disabled={disabled}
        data-testid="exec-assignee"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full"
      >
        <option value="">Belum di-assign</option>
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </NativeSelect>
      {error ? (
        <p id={`${id}-error`} className="m-0 text-sm font-medium text-destructive" data-testid="field-error-assigneeId">
          {error}
        </p>
      ) : null}
    </div>
  );
}
