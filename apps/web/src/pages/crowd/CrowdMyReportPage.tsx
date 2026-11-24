import type { CrowdReportDto } from "@testpulse/shared";
import { FileSearch, Pencil, Undo2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CrowdComments } from "@/components/CrowdComments";
import { CrowdReportContent } from "@/components/CrowdReportContent";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { cyclePublicPath, REJECT_REASON_LABEL, REPORT_STATUS_LABEL, reportCode, reportPublicPath } from "@/lib/crowd";
import { formatRelativeTime } from "@/lib/format";
import { errorMessage, useDocumentTitle } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";

/** `/crowd/r/:reportId`: laporan saya (spec Tahap 5 §9.2). Laporan orang lain dijawab API dengan 404. */
export function CrowdMyReportPage() {
  const { reportId = "" } = useParams();
  const report = useLoad(useCallback(() => api.crowd.report(reportId), [reportId]));
  useDocumentTitle(report.state === "ready" ? report.data.title : "Laporan saya");

  if (report.state === "loading") return <Loading label="Memuat laporan…" />;
  if (report.state === "error") {
    if (report.error instanceof ApiError && report.error.status === 404) {
      return (
        <EmptyState icon={FileSearch} title="Laporan tidak ditemukan" headingLevel="h1" data-testid="report-not-found">
          <p>
            Laporan ini tidak ada atau bukan milik Anda. <Link to="/crowd/me">Lihat laporan saya</Link>
          </p>
        </EmptyState>
      );
    }
    return <LoadError error={report.error} fallback="Gagal memuat laporan. Coba lagi." onRetry={report.reload} />;
  }
  return <ReportView report={report.data} reload={report.reload} />;
}

function TriageResult({ report }: { report: CrowdReportDto }) {
  if (report.status === "accepted" && report.finalSeverity) {
    return (
      <p className="m-0 font-medium" data-testid="my-report-points">
        +{report.points} poin · {BUG_SEVERITY_LABEL[report.finalSeverity]}
      </p>
    );
  }
  if (report.status === "rejected" && report.rejectReason) {
    return (
      <div className="grid gap-1" data-testid="my-report-triage">
        <p className="m-0 font-medium">Alasan: {REJECT_REASON_LABEL[report.rejectReason]}</p>
        {report.triageNote ? <p className="m-0 text-sm [overflow-wrap:anywhere]">{report.triageNote}</p> : null}
      </div>
    );
  }
  if (report.status === "duplicate" && report.duplicateOf) {
    return (
      <p className="m-0 [overflow-wrap:anywhere]" data-testid="my-report-triage">
        Duplikat dari {reportCode(report.duplicateOf.number)} · “{report.duplicateOf.title}”
      </p>
    );
  }
  return null;
}

function ReportView({ report, reload }: { report: CrowdReportDto; reload: () => void }) {
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = report.status === "submitted";

  async function withdraw() {
    setError(null);
    try {
      await api.crowd.withdrawReport(report.id);
      setConfirming(false);
      reload();
    } catch (err) {
      setError(errorMessage(err, "Gagal menarik laporan. Coba lagi."));
    }
  }

  const loadComments = useCallback((cursor?: string) => api.crowd.comments(report.id, cursor), [report.id]);
  const addComment = useCallback((body: string) => api.crowd.addComment(report.id, { body }), [report.id]);
  const removeComment = useCallback((id: string) => api.crowd.deleteComment(report.id, id), [report.id]);

  return (
    <article aria-labelledby="report-title" className="grid min-w-0 grid-cols-1 gap-6">
      <nav aria-label="Breadcrumb" className="text-sm [overflow-wrap:anywhere]">
        <Link to={cyclePublicPath(report.cycle.id)}>{report.cycle.title}</Link>
      </nav>
      <header className="grid min-w-0 gap-2">
        <p className="m-0 font-mono text-sm text-muted-foreground">{reportCode(report.number)}</p>
        <h1 id="report-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {report.title}
        </h1>
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium" data-testid="my-report-status">
            {REPORT_STATUS_LABEL[report.status]}
          </span>
          <SeverityBadge severity={report.finalSeverity ?? report.suggestedSeverity} />
          <span className="text-muted-foreground">Dikirim {formatRelativeTime(report.submittedAt)}</span>
        </p>
        <TriageResult report={report} />
      </header>

      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to={`${reportPublicPath(report.id)}/edit`} data-testid="report-edit">
              <Pencil aria-hidden="true" />
              Ubah
            </Link>
          </Button>
          {confirming ? (
            <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Konfirmasi tarik laporan">
              <span className="text-sm">Tarik laporan ini? Tidak bisa dibatalkan.</span>
              <Button type="button" variant="destructive" size="sm" onClick={() => void withdraw()} data-testid="report-withdraw-confirm">
                Ya, tarik
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Batal
              </Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirming(true)} data-testid="report-withdraw">
              <Undo2 aria-hidden="true" />
              Tarik laporan
            </Button>
          )}
        </div>
      ) : null}
      <p role="alert" className={error ? "m-0 text-sm font-medium text-destructive" : "sr-only"}>
        {error}
      </p>

      <CrowdReportContent report={report} />

      <CrowdComments load={loadComments} add={addComment} remove={removeComment} currentUserId={user?.id ?? null} canWrite />
    </article>
  );
}
