import { coveragePercent } from "@testpulse/shared";

const SCALE = 100;

interface CoverageMeterProps {
  /** Case aktif di seluruh project. */
  active: number;
  /** Dari case aktif itu, yang sudah tertaut ke automated test. */
  automated: number;
}

/**
 * Meter cakupan otomasi (spec Tahap 4 §8.2): teks "X dari Y case aktif sudah diotomasi (Z%)" dan bar. Persen dari
 * `coveragePercent` bersama (dibulatkan ke bawah, `null` tanpa case aktif). Bar adalah SVG dekoratif: lebar isian lewat
 * atribut `width` (bukan `style`, CSP) dan warna lewat kelas token tema; angkanya selalu ada sebagai teks.
 */
export function CoverageMeter({ active, automated }: CoverageMeterProps) {
  const percent = coveragePercent(active, automated);
  return (
    <div data-testid="coverage-meter" className="grid min-w-0 gap-2 rounded-lg border bg-card p-4 text-card-foreground">
      <p className="m-0 text-sm font-medium">
        {percent === null
          ? "Belum ada case aktif untuk diotomasi."
          : `${automated} dari ${active} case aktif sudah diotomasi (${percent}%)`}
      </p>
      {percent === null ? null : (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${SCALE} 8`}
          preserveAspectRatio="none"
          className="block h-2 w-full overflow-hidden rounded-full forced-colors:outline forced-colors:outline-1 forced-colors:outline-[color:CanvasText]"
        >
          <rect width={SCALE} height={8} className="fill-muted forced-colors:fill-[color:Canvas]" />
          <rect width={percent} height={8} className="fill-primary forced-colors:fill-[color:Highlight]" />
        </svg>
      )}
    </div>
  );
}
