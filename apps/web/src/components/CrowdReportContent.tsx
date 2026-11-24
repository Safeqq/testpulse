import type { CrowdReportDto } from "@testpulse/shared";
import { ExternalLink } from "@/components/ExternalLink";
import { LazyMarkdown } from "@/components/LazyMarkdown";
import { REPORT_STATUS_LABEL } from "@/lib/crowd";
import { formatDateTime } from "@/lib/format";

type Content = Pick<CrowdReportDto, "steps" | "expected" | "actual" | "environment" | "links" | "events">;

/**
 * Isi laporan crowd (spec Tahap 5 §9.2, §9.3): langkah, hasil, lingkungan, link bukti, dan riwayat. Dipakai halaman
 * laporan saya dan halaman triase; semua teks dari crowd lewat Markdown aman atau teks biasa.
 */
export function CrowdReportContent({ report }: { report: Content }) {
  return (
    <>
      <section aria-labelledby="report-steps-title" className="grid min-w-0 gap-2">
        <h2 id="report-steps-title" className="text-lg font-semibold">
          Langkah reproduksi
        </h2>
        <LazyMarkdown source={report.steps} />
      </section>
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        <section aria-labelledby="report-expected-title" className="grid min-w-0 content-start gap-2">
          <h2 id="report-expected-title" className="text-lg font-semibold">
            Hasil yang diharapkan
          </h2>
          <LazyMarkdown source={report.expected} />
        </section>
        <section aria-labelledby="report-actual-title" className="grid min-w-0 content-start gap-2">
          <h2 id="report-actual-title" className="text-lg font-semibold">
            Hasil yang terjadi
          </h2>
          <LazyMarkdown source={report.actual} />
        </section>
      </div>
      <p className="m-0 text-sm [overflow-wrap:anywhere]">
        <span className="font-medium">Lingkungan:</span> {report.environment}
      </p>
      {report.links.length > 0 ? (
        <section aria-labelledby="report-links-title" className="grid min-w-0 gap-2">
          <h2 id="report-links-title" className="text-lg font-semibold">
            Link bukti
          </h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {report.links.map((link, i) => (
              <li key={i} className="min-w-0">
                <ExternalLink href={link.url} label={link.title ?? link.url} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="report-timeline-title" className="grid min-w-0 gap-2">
        <h2 id="report-timeline-title" className="text-lg font-semibold">
          Riwayat
        </h2>
        <ol className="m-0 grid list-none gap-1 p-0 text-sm" data-testid="report-timeline">
          {report.events.map((event) => (
            <li key={event.id} className="[overflow-wrap:anywhere]">
              <span className="font-medium">{event.actor.name}</span>{" "}
              {event.fromStatus === null ? "mengirim laporan" : `mengubah status menjadi ${REPORT_STATUS_LABEL[event.toStatus]}`}
              <span className="text-muted-foreground"> · {formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
