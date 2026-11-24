import {
  BUG_PRIORITIES,
  CROWD_SEVERITIES,
  REJECT_REASONS,
  triageBody,
  type BugPriority,
  type CrowdReportListItemDto,
  type CrowdSeverity,
  type ProjectDto,
  type RejectReason,
  type TeamCrowdReportDto,
} from "@testpulse/shared";
import { Check, Copy, FileSearch, Loader2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CrowdComments } from "@/components/CrowdComments";
import { CrowdReportContent } from "@/components/CrowdReportContent";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { NativeSelect } from "@/components/NativeSelect";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BUG_PRIORITY_LABEL, BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { cycleCode, REJECT_REASON_LABEL, REPORT_STATUS_LABEL, reportCode, testerPath } from "@/lib/crowd";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { errorMessage, focusField, serverErrorToForm } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";
import { cn } from "@/lib/utils";
import { ProjectFrame } from "./ProjectFrame";

type Mode = "accept" | "reject" | "duplicate";
const MODE_LABEL: Record<Mode, string> = { accept: "Terima", reject: "Tolak", duplicate: "Duplikat" };
const TRIAGE_FIELDS = ["severity", "priority", "reason", "note", "duplicateOf"] as const;

/** `/p/:slug/crowd-reports/:number`: triase satu laporan crowd (spec Tahap 5 §9.3). */
export function CrowdTriagePage() {
  const { slug = "", number = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title={`Laporan ${reportCode(Number(number))}`} tab="crowd">
      {(project) => <TriageLoader key={number} project={project} number={Number(number)} />}
    </ProjectFrame>
  );
}

function TriageLoader({ project, number }: { project: ProjectDto; number: number }) {
  const load = useLoad(useCallback(() => api.crowdReports.get(project.slug, number), [project.slug, number]));
  if (load.state === "loading") return <Loading label="Memuat laporan…" />;
  if (load.state === "error") {
    if (load.error instanceof ApiError && load.error.status === 404) {
      return (
        <EmptyState icon={FileSearch} title="Laporan tidak ditemukan" headingLevel="h1" data-testid="triage-not-found">
          <p>
            <Link to={`/p/${encodeURIComponent(project.slug)}/cycles`}>Kembali ke crowdtesting</Link>
          </p>
        </EmptyState>
      );
    }
    return <LoadError error={load.error} fallback="Gagal memuat laporan. Coba lagi." onRetry={load.reload} />;
  }
  // key: muat ulang setelah bentrok memasang versi terbaru dari server dengan panel bersih.
  return <TriageView key={`${load.data.id}-${load.data.version}`} project={project} initial={load.data} reload={load.reload} />;
}

function TriageView({ project, initial, reload }: { project: ProjectDto; initial: TeamCrowdReportDto; reload: () => void }) {
  const { user } = useAuth();
  const [report, setReport] = useState(initial);
  const [conflict, setConflict] = useState(false);
  const slug = project.slug;
  const canTriage = project.myRole === "tester" || project.myRole === "admin";
  const base = `/p/${encodeURIComponent(slug)}`;

  const loadComments = useCallback((cursor?: string) => api.crowdReports.comments(slug, report.number, cursor), [slug, report.number]);
  const addComment = useCallback((body: string) => api.crowdReports.addComment(slug, report.number, { body }), [slug, report.number]);
  const removeComment = useCallback((id: string) => api.crowdReports.deleteComment(slug, report.number, id), [slug, report.number]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <article aria-labelledby="triage-title" className="grid min-w-0 gap-6" data-testid="triage-report">
        <nav aria-label="Breadcrumb" className="text-sm [overflow-wrap:anywhere]">
          <Link to={`${base}/cycles/${report.cycle.number}`}>
            {cycleCode(report.cycle.number)} · {report.cycle.title}
          </Link>
        </nav>
        <header className="grid min-w-0 gap-2">
          <p className="m-0 font-mono text-sm text-muted-foreground">{reportCode(report.number)}</p>
          <h1 id="triage-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {report.title}
          </h1>
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span>
              <span className="sr-only">Status: </span>
              <span className="font-medium" data-testid="triage-status">
                {REPORT_STATUS_LABEL[report.status]}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="text-muted-foreground">Usulan:</span>
              <SeverityBadge severity={report.suggestedSeverity} />
            </span>
            <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              Pelapor:{" "}
              <Link to={testerPath(report.reporter.id)} className={INLINE_LINK_CLASS} data-testid="triage-reporter">
                {report.reporter.name}
              </Link>
            </span>
            <time className="text-muted-foreground" dateTime={report.submittedAt} title={formatDateTime(report.submittedAt)}>
              Dikirim {formatRelativeTime(report.submittedAt)}
            </time>
          </p>
        </header>
        <CrowdReportContent report={report} />
        <CrowdComments load={loadComments} add={addComment} remove={removeComment} currentUserId={user?.id ?? null} canWrite={canTriage} />
      </article>

      <aside aria-labelledby="triage-panel-title" className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 lg:sticky lg:top-4" data-testid="triage-panel">
        <h2 id="triage-panel-title" className="text-lg font-semibold">
          Triase
        </h2>
        {conflict ? (
          <div role="alert" className="grid gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm" data-testid="triage-conflict">
            <p className="m-0 font-medium">Laporan ini baru saja ditriase atau diubah anggota tim lain. Keputusan Anda belum disimpan.</p>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={reload} data-testid="triage-conflict-reload">
                Muat versi terbaru
              </Button>
            </div>
          </div>
        ) : null}
        <TriageResult slug={slug} report={report} />
        {canTriage && report.status === "submitted" ? (
          <DecisionForm slug={slug} report={report} onSaved={setReport} onConflict={() => setConflict(true)} />
        ) : null}
        {canTriage && (report.status === "rejected" || report.status === "duplicate") ? (
          <Reopen slug={slug} report={report} onSaved={setReport} onConflict={() => setConflict(true)} />
        ) : null}
        {canTriage && report.status === "accepted" ? (
          <HideToggle slug={slug} report={report} onSaved={setReport} onConflict={() => setConflict(true)} />
        ) : null}
      </aside>
    </div>
  );
}

/** Hasil triase yang sudah tersimpan (terlihat semua anggota). */
function TriageResult({ slug, report }: { slug: string; report: TeamCrowdReportDto }) {
  const by = report.triagedBy ? ` oleh ${report.triagedBy.name}` : "";
  if (report.status === "submitted") {
    return <p className="m-0 text-sm text-muted-foreground">Menunggu keputusan tim.</p>;
  }
  return (
    <div className="grid min-w-0 gap-1 text-sm [overflow-wrap:anywhere]" data-testid="triage-result">
      {report.status === "accepted" ? (
        <>
          <p className="m-0">
            Diterima{by} sebagai {report.finalSeverity ? BUG_SEVERITY_LABEL[report.finalSeverity] : "—"} · +{report.points} poin
          </p>
          {report.bug ? (
            <p className="m-0">
              <Link to={`/p/${encodeURIComponent(slug)}/bugs/${report.bug.number}`} className={INLINE_LINK_CLASS} data-testid="triage-bug-link">
                Bug #{report.bug.number} dibuat
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
      {report.status === "rejected" ? (
        <>
          <p className="m-0">
            Ditolak{by}: {report.rejectReason ? REJECT_REASON_LABEL[report.rejectReason] : "—"}
          </p>
          {report.triageNote ? <p className="m-0 text-muted-foreground">{report.triageNote}</p> : null}
        </>
      ) : null}
      {report.status === "duplicate" && report.duplicateOf ? (
        <p className="m-0">
          Duplikat{by} dari{" "}
          <Link to={`/p/${encodeURIComponent(slug)}/crowd-reports/${report.duplicateOf.number}`} className={INLINE_LINK_CLASS}>
            {reportCode(report.duplicateOf.number)} · {report.duplicateOf.title}
          </Link>
        </p>
      ) : null}
      {report.status === "withdrawn" ? <p className="m-0">Ditarik oleh pelapor.</p> : null}
    </div>
  );
}

interface ActionProps {
  slug: string;
  report: TeamCrowdReportDto;
  onSaved: (report: TeamCrowdReportDto) => void;
  onConflict: () => void;
}

function isConflict(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "REPORT_CONFLICT" || err.code === "INVALID_TRIAGE");
}

/** Panel keputusan: state lokal; bila bentrok (`409`) isian tetap di tempat. */
function DecisionForm({ slug, report, onSaved, onConflict }: ActionProps) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { severity: useId(), priority: useId(), note: useId(), search: useId() };
  const [mode, setMode] = useState<Mode | null>(null);
  const [severity, setSeverity] = useState<CrowdSeverity>(report.suggestedSeverity);
  const [priority, setPriority] = useState<BugPriority>("medium");
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const [duplicateOf, setDuplicateOf] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "next" | null>(null);

  function bodyFor(m: Mode) {
    const version = report.version;
    if (m === "accept") return { version, decision: "accept" as const, severity, priority };
    if (m === "reject") return { version, decision: "reject" as const, reason: reason === "" ? undefined : reason, ...(note.trim() ? { note: note.trim() } : {}) };
    return { version, decision: "duplicate" as const, duplicateOf: duplicateOf ?? undefined };
  }

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === null || submitting) return;
    const intent = (event.nativeEvent as SubmitEvent).submitter?.dataset.intent === "next" ? "next" : "save";
    const parsed = triageBody.safeParse(bodyFor(mode));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.map(String).join(".") || "form"] ??= issue.message;
      if (mode === "duplicate" && fields.duplicateOf) fields.duplicateOf = "Pilih laporan asli";
      return fail(fields, null);
    }
    setFieldErrors({});
    setFormError(null);
    setSubmitting(intent);
    try {
      const saved = await api.crowdReports.triage(slug, report.number, parsed.data);
      if (intent === "next") {
        navigate(
          saved.nextSubmittedNumber === null
            ? `/p/${encodeURIComponent(slug)}/cycles/${saved.cycle.number}`
            : `/p/${encodeURIComponent(slug)}/crowd-reports/${saved.nextSubmittedNumber}`,
        );
        return;
      }
      onSaved(saved);
    } catch (err) {
      setSubmitting(null);
      if (isConflict(err)) return onConflict();
      const mapped = serverErrorToForm(err, TRIAGE_FIELDS);
      fail(mapped.fields, mapped.message);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={submitting !== null} className="grid min-w-0 gap-4">
      <div role="group" aria-label="Keputusan" className="flex flex-wrap gap-2">
        {(["accept", "reject", "duplicate"] as const).map((m) => (
          <Button
            key={m}
            type="button"
            variant={mode === m ? "default" : "outline"}
            size="sm"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setFieldErrors({});
            }}
            data-testid={`triage-${m}`}
          >
            {m === "accept" ? <Check aria-hidden="true" /> : m === "reject" ? <X aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {MODE_LABEL[m]}
          </Button>
        ))}
      </div>
      <FormError message={formError} />

      {mode === "accept" ? (
        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.severity}>Severity bug</Label>
            <NativeSelect id={ids.severity} name="severity" value={severity} onChange={(e) => setSeverity(e.target.value as CrowdSeverity)} data-testid="triage-severity">
              {CROWD_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {BUG_SEVERITY_LABEL[s]}
                  {s === report.suggestedSeverity ? " (usulan pelapor)" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.priority}>Prioritas</Label>
            <NativeSelect id={ids.priority} name="priority" value={priority} onChange={(e) => setPriority(e.target.value as BugPriority)} data-testid="triage-priority">
              {BUG_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {BUG_PRIORITY_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className="m-0 text-sm text-muted-foreground">Menerima membuat bug baru berlabel “crowd” dan memberi poin ke pelapor.</p>
        </div>
      ) : null}

      {mode === "reject" ? (
        <div className="grid min-w-0 gap-3">
          <fieldset className="grid min-w-0 gap-2" data-testid="triage-reason" aria-describedby={fieldErrors.reason ? "triage-reason-error" : undefined}>
            <legend className="mb-1 text-sm font-medium">Alasan</legend>
            {REJECT_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-primary" />
                {REJECT_REASON_LABEL[r]}
              </label>
            ))}
            {fieldErrors.reason ? (
              <p id="triage-reason-error" className="m-0 text-sm font-medium text-destructive" data-testid="field-error-reason">
                {fieldErrors.reason}
              </p>
            ) : null}
          </fieldset>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.note}>Catatan untuk pelapor{reason === "other" ? "" : " (opsional)"}</Label>
            <textarea
              id={ids.note}
              name="note"
              value={note}
              rows={3}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={fieldErrors.note ? true : undefined}
              aria-describedby={fieldErrors.note ? `${ids.note}-error` : undefined}
              className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden"
              data-testid="triage-note"
            />
            {fieldErrors.note ? (
              <p id={`${ids.note}-error`} className="m-0 text-sm font-medium text-destructive" data-testid="field-error-note">
                {fieldErrors.note}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "duplicate" ? (
        <DuplicatePicker slug={slug} report={report} searchId={ids.search} value={duplicateOf} onChange={setDuplicateOf} error={fieldErrors.duplicateOf} />
      ) : null}

      {mode !== null ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting !== null} data-intent="save" data-testid="triage-save">
            {submitting === "save" ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Simpan
          </Button>
          <Button type="submit" variant="outline" disabled={submitting !== null} data-intent="next" data-testid="triage-save-next">
            {submitting === "next" ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Simpan &amp; berikutnya
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Kandidat duplikat yang sah: cycle yang sama, dikirim lebih dulu, bukan dirinya, berstatus dikirim atau diterima. */
function isCandidate(item: CrowdReportListItemDto, report: TeamCrowdReportDto): boolean {
  if (item.id === report.id) return false;
  const a = Date.parse(item.submittedAt);
  const b = Date.parse(report.submittedAt);
  return a < b || (a === b && item.number < report.number);
}

function DuplicatePicker({
  slug,
  report,
  searchId,
  value,
  onChange,
  error,
}: {
  slug: string;
  report: TeamCrowdReportDto;
  searchId: string;
  value: number | null;
  onChange: (n: number) => void;
  error?: string;
}) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const byNumber = /^\d+$/.test(term);
  const load = useLoad(
    useCallback(async () => {
      const query = byNumber || term === "" ? {} : { q: term };
      const [submitted, accepted] = await Promise.all([
        api.cycles.reports(slug, report.cycle.number, { status: "submitted", ...query }),
        api.cycles.reports(slug, report.cycle.number, { status: "accepted", ...query }),
      ]);
      return [...accepted.items, ...submitted.items]
        .filter((item) => isCandidate(item, report))
        .filter((item) => !byNumber || String(item.number).startsWith(term))
        .sort((x, y) => x.number - y.number);
    }, [slug, report, term, byNumber]),
  );

  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={searchId}>Cari laporan asli (nomor atau judul)</Label>
      <Input id={searchId} type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} data-testid="triage-duplicate-search" />
      <p className="m-0 text-sm text-muted-foreground">Hanya laporan di cycle ini yang dikirim lebih dulu dan berstatus Dikirim atau Diterima.</p>
      {load.state === "loading" ? <Loading label="Mencari laporan…" /> : null}
      {load.state === "error" ? <LoadError error={load.error} fallback="Gagal mencari laporan. Coba lagi." onRetry={load.reload} /> : null}
      {load.state === "ready" ? (
        load.data.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground" data-testid="triage-duplicate-empty">
            Tidak ada kandidat.
          </p>
        ) : (
          <fieldset className="grid min-w-0 gap-1">
            <legend className="sr-only">Laporan asli</legend>
            {load.data.map((item) => (
              <label key={item.id} className="flex min-w-0 items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent">
                <input
                  type="radio"
                  name="duplicateOf"
                  value={item.number}
                  checked={value === item.number}
                  onChange={() => onChange(item.number)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  data-testid={`triage-duplicate-option-${item.number}`}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-mono text-muted-foreground">{reportCode(item.number)}</span> {item.title}{" "}
                  <span className="text-muted-foreground">· {REPORT_STATUS_LABEL[item.status]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )
      ) : null}
      {error ? (
        <p className="m-0 text-sm font-medium text-destructive" data-testid="field-error-duplicateOf">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Reopen({ slug, report, onSaved, onConflict }: ActionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.crowdReports.triage(slug, report.number, { version: report.version, decision: "reopen" }));
    } catch (err) {
      if (isConflict(err)) onConflict();
      else setError(errorMessage(err, "Gagal mengembalikan laporan. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void reopen()} data-testid="triage-reopen">
          {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Undo2 aria-hidden="true" />}
          Kembalikan ke antrian
        </Button>
      </div>
      <p role="alert" className={error ? "m-0 text-sm font-medium text-destructive" : "sr-only"}>
        {error}
      </p>
    </div>
  );
}

function HideToggle({ slug, report, onSaved, onConflict }: ActionProps) {
  const id = useId();
  // Optimistis: kotak centang langsung berubah, dan kembali bila penyimpanan gagal.
  const [checked, setChecked] = useState(report.hideFromKnownIssues);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle(hide: boolean) {
    setChecked(hide);
    setBusy(true);
    setError(null);
    try {
      const saved = await api.crowdReports.setHidden(slug, report.number, { version: report.version, hideFromKnownIssues: hide });
      onSaved(saved);
      setMessage(hide ? "Laporan disembunyikan dari daftar masalah diketahui." : "Laporan tampil lagi di daftar masalah diketahui.");
    } catch (err) {
      setChecked(!hide);
      if (isConflict(err)) onConflict();
      else setError(errorMessage(err, "Gagal mengubah. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className={cn("flex items-start gap-2 text-sm", busy && "opacity-70")}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-primary"
          data-testid="triage-hide"
        />
        <span>Sembunyikan dari daftar masalah diketahui (mis. masalah keamanan)</span>
      </label>
      <p role="status" className={message ? "m-0 text-sm text-muted-foreground" : "sr-only"} data-testid="triage-hide-message">
        {message}
      </p>
      <p role="alert" className={error ? "m-0 text-sm font-medium text-destructive" : "sr-only"}>
        {error}
      </p>
    </div>
  );
}
