import {
  BUG_PRIORITIES,
  BUG_SEVERITIES,
  createBugBody,
  type BugPriority,
  type BugSeverity,
  type ProjectDto,
} from "@testpulse/shared";
import { ArrowLeft, Loader2, LockKeyhole } from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { BugLabelsInput } from "@/components/BugLabelsInput";
import { BugLinksInput, type LinkDraft } from "@/components/BugLinksInput";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { FormField } from "@/components/FormField";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { MarkdownEditor, type EditorMode } from "@/components/MarkdownEditor";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { addLabels, remapLinkKeys } from "@/lib/bugForm";
import { BUG_PRIORITY_LABEL, BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { focusField, serverErrorToForm } from "@/lib/forms";
import { caseCode, parseRunNumber, runCode } from "@/lib/manual";
import { loginPathFor } from "@/lib/navigation";
import { useLoad } from "@/lib/useLoad";
import { loadBugReportSource, loadManualBugReportSource, type BugReportPrefill } from "./bugReportSource";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCALAR_FIELDS = ["title", "description", "priority", "severity", "assigneeId"] as const;

/**
 * `/p/:slug/bugs/new`: formulir bug baru; `?testCaseId=&runId=` mengisinya dari test gagal (spec Tahap 3 §7.5),
 * `?manualRun=&manualRunCase=` dari run case manual (spec Tahap 4 §5.4).
 */
export function BugNewPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Buat bug" tab="bug">
      {(project) => <NewBug project={project} />}
    </ProjectFrame>
  );
}

function NewBug({ project }: { project: ProjectDto }) {
  const { pathname, search } = useLocation();
  const [params] = useSearchParams();
  const canWrite = project.myRole === "tester" || project.myRole === "admin";
  // "Buat bug tanpa tautan test": beralih ke formulir kosong lewat state (render sinkron), lalu URL dibersihkan.
  const [skipPrefill, setSkipPrefill] = useState(false);
  const testCaseId = params.get("testCaseId");
  // `runId` tanpa test ditolak server, jadi diabaikan; nilai yang bukan UUID juga (server memvalidasi sisanya).
  const validTestCaseId = testCaseId !== null && UUID.test(testCaseId) ? testCaseId : undefined;
  const runParam = params.get("runId");
  const runId = validTestCaseId && runParam !== null && UUID.test(runParam) ? runParam : undefined;
  // Sumber manual hanya bila tidak ada test (server menolak keduanya sekaligus); nomor run dan id run case harus sah.
  const manualRunParam = params.get("manualRun");
  const manualRun = validTestCaseId || manualRunParam === null ? null : parseRunNumber(manualRunParam);
  const manualRunCaseParam = params.get("manualRunCase");
  const manualRunCase =
    manualRun !== null && manualRunCaseParam !== null && UUID.test(manualRunCaseParam) ? manualRunCaseParam : undefined;
  const source: PrefillSource | null = validTestCaseId
    ? { kind: "test", testCaseId: validTestCaseId, runId }
    : manualRun !== null && manualRunCase !== undefined
      ? { kind: "manual", runNumber: manualRun, runCaseId: manualRunCase }
      : null;

  if (!canWrite) {
    return (
      <EmptyState icon={LockKeyhole} title="Tidak bisa membuat bug" headingLevel="h1" data-testid="bug-new-forbidden">
        <p>
          {project.myRole === "viewer"
            ? "Peran viewer hanya bisa melihat bug. Minta admin project mengubah peranmu menjadi tester untuk melaporkan bug."
            : "Hanya tester dan admin project ini yang bisa membuat bug. Masuk dengan akun anggota untuk melanjutkan."}
        </p>
        {project.myRole === null ? (
          <Link
            to={loginPathFor(`${pathname}${search}`)}
            className="mt-2 inline-block rounded-sm font-medium text-link underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            Masuk
          </Link>
        ) : null}
      </EmptyState>
    );
  }

  return source && !skipPrefill ? (
    <WithPrefill
      key={source.kind === "test" ? `test:${source.testCaseId}:${source.runId ?? ""}` : `manual:${source.runNumber}:${source.runCaseId}`}
      slug={project.slug}
      source={source}
      onSkip={() => setSkipPrefill(true)}
    />
  ) : (
    <BugForm slug={project.slug} prefill={null} />
  );
}

/** Asal isian awal dari URL: test otomatis (dengan run asal bila ada) atau run case manual. */
type PrefillSource =
  | { kind: "test"; testCaseId: string; runId: string | undefined }
  | { kind: "manual"; runNumber: number; runCaseId: string };

interface WithPrefillProps {
  slug: string;
  source: PrefillSource;
  /** Menyerah pada prefill dan membuka formulir kosong. */
  onSkip: () => void;
}

/** Memuat data test (dan pesan error run) atau run case lebih dulu supaya formulir langsung tampil terisi. */
function WithPrefill({ slug, source, onSkip }: WithPrefillProps) {
  const navigate = useNavigate();
  const plainPath = `/p/${encodeURIComponent(slug)}/bugs/new`;
  // Objek `source` dibuat ulang setiap render induk; key di induk memasang ulang komponen ini bila isinya berubah.
  const [stableSource] = useState(source);
  const fetchPrefill = useCallback(
    (): Promise<BugReportPrefill> =>
      stableSource.kind === "test"
        ? loadBugReportSource(slug, stableSource.testCaseId, stableSource.runId)
        : loadManualBugReportSource(slug, stableSource.runNumber, stableSource.runCaseId),
    [slug, stableSource],
  );
  const load = useLoad(fetchPrefill);
  const manual = stableSource.kind === "manual";
  if (load.state === "loading") return <Loading label="Menyiapkan formulir…" />;
  if (load.state === "error") {
    return (
      <div className="grid min-w-0 gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Buat bug</h1>
        <LoadError
          error={load.error}
          fallback={manual ? "Gagal memuat data case. Coba lagi." : "Gagal memuat data test. Coba lagi."}
          onRetry={load.reload}
        />
        <div>
          <Link
            to={plainPath}
            className={BACK_LINK_CLASS}
            onClick={(event) => {
              // Klik biasa saja; Ctrl/Cmd/Shift/klik tengah tetap perilaku bawaan tautan (tab baru).
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              // Formulir dibuat oleh update state biasa, bukan oleh transition navigasi: <select> yang dibuat di render
              // transition membuat WebKit melaporkan style-src-attr dengan target document, yang tidak termaklumi guard CSP.
              // Setelah itu URL dibersihkan; formulir yang sama tetap terpasang karena posisinya di pohon tidak berubah.
              onSkip();
              navigate(plainPath, { replace: true });
            }}
          >
            {manual ? "Buat bug tanpa tautan case" : "Buat bug tanpa tautan test"}
          </Link>
        </div>
      </div>
    );
  }
  return <BugForm slug={slug} prefill={load.data} />;
}

function BugForm({ slug, prefill }: { slug: string; prefill: BugReportPrefill | null }) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [priority, setPriority] = useState<BugPriority>("medium");
  const [severity, setSeverity] = useState<BugSeverity>("major");
  const [assigneeId, setAssigneeId] = useState("");
  const [descriptionMode, setDescriptionMode] = useState<EditorMode>("write");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchMembers = useCallback(() => api.members.list(slug), [slug]);
  const members = useLoad(fetchMembers);

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    // Textarea tersembunyi saat pratinjau dan tidak bisa difokus: kembali ke Tulis dulu (sinkron) sebelum memindahkan fokus.
    if (fields.description) flushSync(() => setDescriptionMode("write"));
    focusField(formRef.current, fields);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Teks label yang belum jadi chip: yang valid ikut terkirim, yang tidak valid menahan penyimpanan dengan pesannya.
    const pendingLabels = addLabels(labels, labelDraft.split(","));

    // Baris link yang sama sekali kosong diabaikan; indeksnya dicatat untuk memetakan error ke baris formulir.
    const rowIndexes = links.flatMap((link, index) => (link.url.trim() === "" && link.title.trim() === "" ? [] : [index]));
    const body = {
      title,
      description,
      priority,
      severity,
      labels: pendingLabels.labels,
      links: rowIndexes.map((index) => ({ url: links[index]!.url.trim(), title: links[index]!.title })),
      ...(assigneeId !== "" ? { assigneeId } : {}),
      ...(prefill?.kind === "test" ? { testCaseId: prefill.testCaseId, ...(prefill.runId ? { runId: prefill.runId } : {}) } : {}),
      ...(prefill?.kind === "manual" ? { manualRunCaseId: prefill.manualRunCaseId } : {}),
    };
    const parsed = createBugBody.safeParse(body);
    if (!parsed.success || pendingLabels.error) {
      const fields: Record<string, string> = {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues) fields[issue.path.map(String).join(".") || "form"] ??= issue.message;
      }
      const remapped = remapLinkKeys(fields, rowIndexes);
      if (pendingLabels.error) remapped.labels = pendingLabels.error;
      return fail(remapped, null);
    }

    setLabels(pendingLabels.labels);
    setLabelDraft("");
    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const bug = await api.bugs.create(slug, parsed.data);
      navigate(`/p/${encodeURIComponent(slug)}/bugs/${bug.number}`);
    } catch (err) {
      const serverKeys = err instanceof ApiError ? Object.keys(err.fields ?? {}) : [];
      const known = serverKeys.filter((key) => (SCALAR_FIELDS as readonly string[]).includes(key) || /^(labels|links)(\.|$)/.test(key));
      const mapped = serverErrorToForm(err, known);
      fail(remapLinkKeys(mapped.fields, rowIndexes), mapped.message);
      setSubmitting(false);
    }
  }

  const memberOptions = members.state === "ready" ? members.data : [];
  const linkErrors = Object.fromEntries(Object.entries(fieldErrors).filter(([key]) => key.startsWith("links")));

  return (
    <section aria-labelledby="bug-new-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-3">
        <Link to={`/p/${encodeURIComponent(slug)}/bugs`} className={BACK_LINK_CLASS} data-testid="bug-new-back">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Daftar bug
        </Link>
        <h1 id="bug-new-title" className="text-2xl font-semibold tracking-tight">
          Buat bug
        </h1>
        {prefill?.kind === "test" ? (
          <p className="m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="bug-new-origin">
            Dilaporkan dari test <span className="font-medium text-foreground">{prefill.testName}</span> ({prefill.suite}
            ). Bug ini akan tertaut ke test{prefill.runId ? " dan run tersebut" : ""}.
          </p>
        ) : null}
        {prefill?.kind === "manual" ? (
          <p className="m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="bug-new-origin">
            Dilaporkan dari test run manual{" "}
            <span className="font-medium text-foreground">
              {runCode(prefill.runNumber)} · {caseCode(prefill.caseNumber)}
            </span>{" "}
            ({prefill.caseTitle}, run {prefill.runName}). Bug ini akan tertaut ke case di run tersebut.
          </p>
        ) : null}
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid min-w-0 gap-5" data-testid="bug-form">
        <FormError message={formError} />
        <FormField name="title" label="Judul" value={title} onChange={setTitle} error={fieldErrors.title} testIdPrefix="bug" />
        <MarkdownEditor
          name="description"
          label="Deskripsi"
          value={description}
          onChange={setDescription}
          error={fieldErrors.description}
          mode={descriptionMode}
          onModeChange={setDescriptionMode}
          hint="Mendukung Markdown. Boleh dikosongkan."
          testId="bug-description"
        />
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField name="priority" label="Prioritas" testId="bug-priority" value={priority} onChange={(v) => setPriority(v as BugPriority)}>
            {BUG_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {BUG_PRIORITY_LABEL[value]}
              </option>
            ))}
          </SelectField>
          <SelectField name="severity" label="Severity" testId="bug-severity" value={severity} onChange={(v) => setSeverity(v as BugSeverity)}>
            {BUG_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {BUG_SEVERITY_LABEL[value]}
              </option>
            ))}
          </SelectField>
          <SelectField name="assigneeId" label="Assignee" testId="bug-assignee" value={assigneeId} onChange={setAssigneeId} error={fieldErrors.assigneeId}>
            <option value="">Belum di-assign</option>
            {memberOptions.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </SelectField>
        </div>
        <BugLabelsInput
          value={labels}
          onChange={setLabels}
          draft={labelDraft}
          onDraftChange={setLabelDraft}
          error={fieldErrors.labels}
        />
        <BugLinksInput value={links} onChange={setLinks} errors={linkErrors} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting} data-testid="bug-submit">
            {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Simpan bug
          </Button>
          <Button asChild variant="outline">
            <Link to={`/p/${encodeURIComponent(slug)}/bugs`}>Batal</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

function SelectField({
  name,
  label,
  testId,
  value,
  onChange,
  error,
  children,
}: {
  name: string;
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5 [&>span]:w-full">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        value={value}
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full"
      >
        {children}
      </NativeSelect>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
