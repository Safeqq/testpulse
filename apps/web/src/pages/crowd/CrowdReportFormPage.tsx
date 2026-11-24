import {
  CROWD_SEVERITIES,
  createCrowdReportBody,
  type CrowdReportDto,
  type CrowdSeverity,
  type PublicCycleDto,
} from "@testpulse/shared";
import { FileSearch, Loader2, Search } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BugLinksInput, newLinkDraft, type LinkDraft } from "@/components/BugLinksInput";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { FormField } from "@/components/FormField";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { remapLinkKeys } from "@/lib/bugForm";
import { BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { cyclePublicPath, reportPublicPath } from "@/lib/crowd";
import { focusField, serverErrorToForm, useDocumentTitle } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";

const SEVERITY_HINT: Record<CrowdSeverity, string> = {
  minor: "Mengganggu kecil, ada jalan lain (mis. teks salah, tampilan sedikit bergeser).",
  major: "Fitur tidak bekerja semestinya, tetapi aplikasi masih bisa dipakai.",
  critical: "Fitur utama rusak atau data salah/hilang; tidak ada jalan lain.",
  blocker: "Aplikasi tidak bisa dipakai sama sekali (crash, tidak bisa masuk).",
};

const BLOCKED_TESTID = { limit: "report-limit", closed: "report-closed", conflict: "report-conflict", triaged: "report-triaged" } as const;

const SCALAR_FIELDS = ["title", "steps", "expected", "actual", "environment", "suggestedSeverity"] as const;

interface Draft {
  title: string;
  steps: string;
  expected: string;
  actual: string;
  environment: string;
  severity: CrowdSeverity;
  links: LinkDraft[];
}

const EMPTY: Draft = { title: "", steps: "", expected: "", actual: "", environment: "", severity: "major", links: [] };

/** `/crowd/c/:id/report` (buat) dan `/crowd/r/:id/edit` (ubah laporan sendiri selama `submitted`), spec Tahap 5 §9.2. */
export function CrowdReportFormPage() {
  const { id = "", reportId } = useParams();
  const editing = reportId !== undefined;
  const report = useLoad(useCallback(() => (reportId ? api.crowd.report(reportId) : Promise.resolve(null)), [reportId]));
  const cycleId = editing ? (report.state === "ready" ? report.data?.cycle.id : undefined) : id;
  const cycle = useLoad(useCallback(() => (cycleId ? api.crowd.cycle(cycleId) : Promise.resolve(null)), [cycleId]));
  useDocumentTitle(editing ? "Ubah laporan" : "Kirim laporan");

  if (report.state === "loading" || cycle.state === "loading") return <Loading label="Memuat…" />;
  if (report.state === "error") return <LoadError error={report.error} fallback="Gagal memuat laporan. Coba lagi." onRetry={report.reload} />;
  if (cycle.state === "error" || cycle.data === null) {
    if (cycle.state === "error" && cycle.error instanceof ApiError && cycle.error.status !== 404) {
      return <LoadError error={cycle.error} fallback="Gagal memuat cycle. Coba lagi." onRetry={cycle.reload} />;
    }
    return (
      <EmptyState icon={FileSearch} title="Cycle tidak ditemukan" headingLevel="h1" data-testid="cycle-not-found">
        <p>
          <Link to="/crowd">Lihat cycle lain</Link>
        </p>
      </EmptyState>
    );
  }
  const c = cycle.data;
  const existing = report.data;
  if (!editing && c.me.state !== "joined") {
    return (
      <EmptyState icon={FileSearch} title="Ikut cycle ini dulu" headingLevel="h1" data-testid="report-not-joined">
        <p>
          Hanya peserta yang bisa mengirim laporan. <Link to={cyclePublicPath(c.id)}>Kembali ke cycle</Link>
        </p>
      </EmptyState>
    );
  }
  return <ReportForm cycle={c} existing={existing} />;
}

function draftOf(report: CrowdReportDto | null): Draft {
  if (!report) return EMPTY;
  return {
    title: report.title,
    steps: report.steps,
    expected: report.expected,
    actual: report.actual,
    environment: report.environment,
    severity: report.suggestedSeverity,
    links: report.links.map((l) => newLinkDraft(l.url, l.title ?? "")),
  };
}

function ReportForm({ cycle, existing }: { cycle: PublicCycleDto; existing: CrowdReportDto | null }) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const envId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(existing));
  const [version, setVersion] = useState(existing?.version ?? 0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ kind: "limit" | "closed" | "conflict" | "triaged"; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const rowIndexes = draft.links.flatMap((link, index) => (link.url.trim() === "" && link.title.trim() === "" ? [] : [index]));
    const body = {
      title: draft.title,
      steps: draft.steps,
      expected: draft.expected,
      actual: draft.actual,
      environment: draft.environment,
      suggestedSeverity: draft.severity,
      links: rowIndexes.map((index) => ({ url: draft.links[index]!.url.trim(), title: draft.links[index]!.title })),
    };
    const parsed = createCrowdReportBody.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.map(String).join(".") || "form"] ??= issue.message;
      return fail(remapLinkKeys(fields, rowIndexes), null);
    }
    setFieldErrors({});
    setFormError(null);
    setBlocked(null);
    setSubmitting(true);
    try {
      const saved = existing
        ? await api.crowd.updateReport(existing.id, { version, ...parsed.data, links: parsed.data.links ?? [] })
        : await api.crowd.submitReport(cycle.id, parsed.data);
      navigate(reportPublicPath(saved.id));
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        // Isian tidak pernah dibuang: pesan ditampilkan di atas form (Review Focus 3).
        if (err.code === "RATE_LIMITED") return setBlocked({ kind: "limit", message: err.message });
        if (err.code === "CYCLE_NOT_OPEN") return setBlocked({ kind: "closed", message: "Cycle sudah ditutup, jadi laporan baru tidak diterima lagi." });
        if (err.code === "REPORT_CONFLICT") return setBlocked({ kind: "conflict", message: "Laporan ini baru saja diubah di tempat lain." });
        if (err.code === "INVALID_TRIAGE") return setBlocked({ kind: "triaged", message: "Laporan ini sudah ditriase atau ditarik, jadi tidak bisa diubah lagi." });
      }
      const serverKeys = err instanceof ApiError ? Object.keys(err.fields ?? {}) : [];
      const known = serverKeys.filter((key) => (SCALAR_FIELDS as readonly string[]).includes(key) || /^links(\.|$)/.test(key));
      const mapped = serverErrorToForm(err, known);
      fail(remapLinkKeys(mapped.fields, rowIndexes), mapped.message);
    }
  }

  async function reloadLatest() {
    if (!existing) return;
    const latest = await api.crowd.report(existing.id);
    setDraft(draftOf(latest));
    setVersion(latest.version);
    setBlocked(null);
  }

  const linkErrors = Object.fromEntries(Object.entries(fieldErrors).filter(([key]) => key.startsWith("links")));

  return (
    <section aria-labelledby="report-form-title" className="grid min-w-0 grid-cols-1 gap-6">
      <nav aria-label="Breadcrumb" className="text-sm [overflow-wrap:anywhere]">
        <Link to={cyclePublicPath(cycle.id)}>{cycle.title}</Link>
      </nav>
      <h1 id="report-form-title" className="text-2xl font-semibold tracking-tight">
        {existing ? "Ubah laporan" : "Kirim laporan bug"}
      </h1>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting} className="order-2 grid min-w-0 gap-5 lg:order-1" data-testid="report-form">
          {blocked ? (
            <div role="alert" className="grid gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm" data-testid={BLOCKED_TESTID[blocked.kind]}>
              <p className="m-0 font-medium">{blocked.message}</p>
              {blocked.kind === "conflict" ? (
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => void reloadLatest()} data-testid="report-conflict-reload">
                    Muat versi terbaru
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <FormError message={formError} />
          <FormField name="title" label="Judul" value={draft.title} onChange={(v) => set("title", v)} error={fieldErrors.title} testIdPrefix="report" hint="Ringkas dan spesifik, mis. “Tombol Simpan error 500 di halaman profil”." />
          <MarkdownEditor
            name="steps"
            label="Langkah reproduksi"
            value={draft.steps}
            onChange={(v) => set("steps", v)}
            error={fieldErrors.steps}
            hint="Tulis langkah bernomor yang bisa diikuti orang lain dari awal."
            testId="report-steps"
            rows={6}
          />
          <MarkdownEditor name="expected" label="Hasil yang diharapkan" value={draft.expected} onChange={(v) => set("expected", v)} error={fieldErrors.expected} testId="report-expected" rows={3} />
          <MarkdownEditor name="actual" label="Hasil yang terjadi" value={draft.actual} onChange={(v) => set("actual", v)} error={fieldErrors.actual} testId="report-actual" rows={3} />

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={envId}>Lingkungan</Label>
            {cycle.environments.length > 0 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Pilih lingkungan target">
                {cycle.environments.map((env, i) => (
                  <Button key={env} type="button" variant="outline" size="sm" className="max-w-full whitespace-normal [overflow-wrap:anywhere]" onClick={() => set("environment", env)} data-testid={`report-env-chip-${i}`}>
                    {env}
                  </Button>
                ))}
              </div>
            ) : null}
            <Input
              id={envId}
              name="environment"
              value={draft.environment}
              onChange={(e) => set("environment", e.target.value)}
              aria-invalid={fieldErrors.environment ? true : undefined}
              aria-describedby={fieldErrors.environment ? `${envId}-error` : `${envId}-hint`}
              data-testid="report-environment"
            />
            <p id={`${envId}-hint`} className="m-0 text-sm text-muted-foreground">
              Browser/perangkat dan versinya, mis. “Chrome 130 / Windows 11”.
            </p>
            {fieldErrors.environment ? (
              <p id={`${envId}-error`} className="m-0 text-sm font-medium text-destructive" data-testid="field-error-environment">
                {fieldErrors.environment}
              </p>
            ) : null}
          </div>

          <fieldset className="grid min-w-0 gap-2" data-testid="report-severity">
            <legend className="mb-1 text-sm font-medium">Severity (usulan)</legend>
            {CROWD_SEVERITIES.map((severity) => (
              <label key={severity} className="flex items-start gap-2 text-sm">
                <input type="radio" name="suggestedSeverity" value={severity} checked={draft.severity === severity} onChange={() => set("severity", severity)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                <span>
                  <span className="font-medium">{BUG_SEVERITY_LABEL[severity]}</span>
                  <span className="text-muted-foreground"> — {SEVERITY_HINT[severity]}</span>
                </span>
              </label>
            ))}
            <p className="m-0 text-sm text-muted-foreground">Tim menetapkan severity final saat triase; poin mengikuti severity final.</p>
          </fieldset>

          <BugLinksInput value={draft.links} onChange={(links) => set("links", links)} errors={linkErrors} max={5} testId="report-links" emptyHint="Tambahkan link bukti (video, gambar yang diunggah di tempat lain, dsb.). Maksimal 5 link." />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting || blocked?.kind === "closed"} data-testid="report-submit">
              {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              {existing ? "Simpan perubahan" : "Kirim laporan"}
            </Button>
            <Button asChild variant="ghost">
              <Link to={existing ? reportPublicPath(existing.id) : cyclePublicPath(cycle.id)}>Batal</Link>
            </Button>
          </div>
        </form>
        <KnownIssuesPanel cycleId={cycle.id} />
      </div>
    </section>
  );
}

/** Panel "Cek dulu masalah yang sudah diketahui" (spec §9.2), bisa dicari, agar laporan tidak dobel. */
function KnownIssuesPanel({ cycleId }: { cycleId: string }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const issues = useLoad(useCallback(() => api.crowd.knownIssues(cycleId), [cycleId]));
  const shown = useMemo(() => {
    if (issues.state !== "ready") return [];
    const q = query.trim().toLowerCase();
    return q === "" ? issues.data.items : issues.data.items.filter((i) => i.title.toLowerCase().includes(q));
  }, [issues, query]);
  return (
    <aside aria-labelledby="known-panel-title" className="order-1 grid min-w-0 content-start gap-3 rounded-xl border bg-card p-4 lg:order-2" data-testid="report-known-issues">
      <h2 id="known-panel-title" className="text-base font-semibold">
        Cek dulu masalah yang sudah diketahui
      </h2>
      <div className="grid gap-1.5">
        <Label htmlFor={searchId}>Cari</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id={searchId} type="search" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="report-known-search" />
        </div>
      </div>
      {issues.state === "loading" ? <Loading label="Memuat…" /> : null}
      {issues.state === "error" ? <LoadError error={issues.error} fallback="Gagal memuat daftar." onRetry={issues.reload} /> : null}
      {issues.state === "ready" ? (
        shown.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{query.trim() === "" ? "Belum ada laporan yang diterima." : "Tidak ada yang cocok."}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {shown.map((issue, i) => (
              <li key={i} className="grid min-w-0 gap-1 text-sm">
                <span className="[overflow-wrap:anywhere]">{issue.title}</span>
                <SeverityBadge severity={issue.severity} />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </aside>
  );
}
