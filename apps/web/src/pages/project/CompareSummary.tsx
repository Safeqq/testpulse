import { COMPARE_GROUPS, type CompareDto, type CompareGroup } from "@testpulse/shared";
import { Fragment, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COMPARE_GROUP_LABEL, compareSentence, pairLabels, type SentenceTone } from "@/lib/compareSummary";
import { compareHref } from "@/lib/navigation";
import type { LoadState } from "@/lib/useLoad";
import { cn } from "@/lib/utils";

interface CompareSummaryProps {
  data: CompareDto;
  slug: string;
  /**
   * Ringkasan di kartu dashboard dan panel detail run: angka lebih kecil dan tanpa tautan kelompok, diakhiri tautan
   * "Lihat perbandingan". Tanpa ini (halaman perbandingan), tiap angka adalah tautan ke kelompoknya.
   */
  compact?: boolean;
  /** Dipanggil saat tautan kelompok diklik, agar halaman dapat membuka kelompok yang tertutup. */
  onGroupLink?: (group: CompareGroup) => void;
}

const TONE_CLASS: Record<SentenceTone, string> = {
  warning: "border-destructive/50 bg-destructive/10",
  success: "border-success/50 bg-success/10",
  neutral: "border-border bg-muted",
};

/** "N regresi baru" ditebalkan di dalam kalimat (spec §4.5); selebihnya teks apa adanya. */
function EmphasizedSentence({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+ regresi baru)/).map((part, index) =>
        index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>,
      )}
    </>
  );
}

/**
 * Kalimat kesimpulan dan baris ringkasan angka sebuah perbandingan (spec Tahap 3 §7.2 butir 2–3). Hanya untuk
 * perbandingan yang punya target; pembanding boleh kosong (kalimat netral, tanpa angka).
 */
export function CompareSummary({ data, slug, compact = false, onGroupLink }: CompareSummaryProps) {
  const { base, target, summary } = data;
  if (!target) return null;
  const labels = pairLabels(base, target);
  const sentence = compareSentence({ summary, baseLabel: labels.base, targetLabel: labels.target });

  return (
    <div className="grid min-w-0 gap-3" data-testid="compare-summary">
      <p
        className={cn(
          "m-0 rounded-lg border px-4 py-3 font-medium text-foreground [overflow-wrap:anywhere]",
          compact ? "text-sm" : "text-base",
          TONE_CLASS[sentence.tone],
        )}
        data-testid="compare-sentence"
        data-tone={sentence.tone}
      >
        <EmphasizedSentence text={sentence.text} />
      </p>
      {base ? (
        <ul
          className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-6"
          aria-label="Ringkasan perbandingan"
        >
          {COMPARE_GROUPS.map((group) => (
            <li key={group} className="min-w-0">
              <CountCell group={group} count={summary[group]} compact={compact} onGroupLink={onGroupLink} />
            </li>
          ))}
        </ul>
      ) : null}
      {compact && base ? (
        <p className="m-0 text-sm">
          <Link
            to={compareHref(slug, { base: base.id, target: target.id, branch: target.branch })}
            className={INLINE_LINK_CLASS}
            data-testid="compare-open"
          >
            Lihat perbandingan
          </Link>
        </p>
      ) : null}
    </div>
  );
}

const CELL_CLASS = "grid min-w-0 content-start gap-0.5 rounded-lg border px-3 py-2 text-card-foreground";

function CountCell({
  group,
  count,
  compact,
  onGroupLink,
}: {
  group: CompareGroup;
  count: number;
  compact: boolean;
  onGroupLink: ((group: CompareGroup) => void) | undefined;
}) {
  // Regresi baru yang ada diberi warna peringatan; kelompok lain netral.
  const tone = group === "regressions" && count > 0 ? "border-destructive/50 bg-destructive/10" : "bg-card";
  const content = (
    <>
      <span className={cn("font-mono font-semibold tabular-nums", compact ? "text-lg" : "text-2xl")}>{count}</span>{" "}
      <span className="text-sm [overflow-wrap:anywhere]">{COMPARE_GROUP_LABEL[group]}</span>
    </>
  );
  if (compact) {
    return (
      <div className={cn(CELL_CLASS, tone)} data-testid={`compare-count-${group}`}>
        {content}
      </div>
    );
  }
  return (
    <a
      href={`#compare-group-${group}`}
      className={cn(
        CELL_CLASS,
        tone,
        "h-full text-foreground no-underline outline-hidden hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring",
      )}
      data-testid={`compare-count-${group}`}
      onClick={() => onGroupLink?.(group)}
    >
      {content}
    </a>
  );
}

/** Kegagalan memuat ringkasan di kartu dashboard/panel run: satu baris, tidak menyembunyikan kartunya. */
export function CompareSummaryError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-destructive">
      <p className="m-0">Gagal memuat perbandingan.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}

interface CompareSummaryCardProps {
  slug: string;
  summary: LoadState<CompareDto> & { reload: () => void };
  testId: string;
  /** Judul kartu dari label pasangan (sudah dibedakan bila sama). */
  title: (labels: { base: string; target: string }) => ReactNode;
}

/**
 * Kartu ringkasan perbandingan di dashboard dan detail run. Tempatnya dipesan sejak awal: selama memuat kartu sudah
 * ada (aria-busy, tinggi minimum ≈ kartu terisi di layar lebar) sehingga isi di bawahnya tidak bergeser saat ringkasan tiba; baru hilang bila
 * ternyata tidak ada pembanding. Kegagalan dan "Coba lagi" tetap di dalam kartu yang sama, dan fokus dipindah ke kartu
 * sebelum memuat ulang supaya tombol yang hilang tidak menjatuhkan fokus ke <body>.
 */
export function CompareSummaryCard({ slug, summary, testId, title }: CompareSummaryCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  if (summary.state === "ready" && (!summary.data.base || !summary.data.target)) return null;
  const { data } = summary.state === "ready" ? summary : { data: null };
  const labels = data?.base && data.target ? pairLabels(data.base, data.target) : null;

  return (
    <Card
      ref={cardRef}
      tabIndex={-1}
      aria-busy={summary.state === "loading"}
      data-testid={testId}
      data-state={summary.state}
      className="min-h-[15.25rem] min-w-0 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      {data && labels?.base ? (
        <>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
                {title({ base: labels.base, target: labels.target })}
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CompareSummary data={data} slug={slug} compact />
          </CardContent>
        </>
      ) : (
        <CardContent>
          {summary.state === "error" ? (
            <CompareSummaryError
              onRetry={() => {
                cardRef.current?.focus();
                summary.reload();
              }}
            />
          ) : (
            <Loading label="Memuat perbandingan…" />
          )}
        </CardContent>
      )}
    </Card>
  );
}
