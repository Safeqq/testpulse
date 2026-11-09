import type { ManualCountsDto } from "@testpulse/shared";
import { runProgressLegend } from "@/lib/manual";
import { cn } from "@/lib/utils";

const SCALE = 100;
const HEIGHT = 8;

interface RunProgressProps {
  counts: ManualCountsDto;
  total: number;
  className?: string;
}

// Urutan segmen bar; warna lewat kelas token tema. Legenda teks selalu ada, jadi warna bukan satu-satunya penanda.
const SEGMENTS = [
  { key: "passed", fill: "fill-success forced-colors:fill-[color:Highlight]" },
  { key: "failed", fill: "fill-destructive forced-colors:fill-[color:LinkText]" },
  { key: "blocked", fill: "fill-foreground/60 forced-colors:fill-[color:GrayText]" },
  { key: "skipped", fill: "fill-muted-foreground/60 forced-colors:fill-[color:ButtonBorder]" },
] as const;

/**
 * Progres eksekusi sebuah run (spec Tahap 4 §8.5): bar bersegmen dan legenda teks "18/25 dieksekusi · 15 lulus · 2 gagal ·
 * 1 diblokir". Bar adalah SVG dekoratif: panjang tiap segmen lewat atribut `x`/`width` (bukan `style`, CSP), sama seperti
 * `CoverageMeter`; semua angkanya ada di legenda.
 */
export function RunProgress({ counts, total, className }: RunProgressProps) {
  // Tiap segmen mulai tepat di akhir segmen sebelumnya (jumlah lebar segmen di depannya).
  const widths = SEGMENTS.map(({ key }) => (total > 0 ? (counts[key] / total) * SCALE : 0));
  const segments = SEGMENTS.flatMap(({ key, fill }, index) => {
    const width = widths[index]!;
    const x = widths.slice(0, index).reduce((sum, w) => sum + w, 0);
    return width > 0 ? [{ key, fill, x, width }] : [];
  });
  return (
    <div data-testid="run-progress" className={cn("grid min-w-0 gap-1.5", className)}>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${SCALE} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-2 w-full overflow-hidden rounded-full forced-colors:outline forced-colors:outline-1 forced-colors:outline-[color:CanvasText]"
      >
        <rect width={SCALE} height={HEIGHT} className="fill-muted forced-colors:fill-[color:Canvas]" />
        {segments.map((segment) => (
          <rect key={segment.key} x={segment.x} width={segment.width} height={HEIGHT} className={segment.fill} />
        ))}
      </svg>
      <p className="m-0 text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="run-progress-legend">
        {runProgressLegend(counts, total)}
      </p>
    </div>
  );
}
