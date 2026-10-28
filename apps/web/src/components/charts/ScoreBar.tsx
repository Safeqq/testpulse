const SCALE = 100;

/**
 * Bar skor flaky 0–100 sebagai SVG murni: lebar isian lewat atribut `width` (bukan `style`, CSP) dan warna lewat kelas
 * utilitas (token tema). Angka skor selalu ditampilkan di sebelahnya oleh pemanggil; `aria-label` memuat angka yang sama.
 */
export function ScoreBar({ score }: { score: number }) {
  const value = Math.min(SCALE, Math.max(0, Math.round(score)));
  return (
    <svg
      role="img"
      aria-label={`Skor flaky ${value} dari ${SCALE}`}
      viewBox={`0 0 ${SCALE} 8`}
      preserveAspectRatio="none"
      className="block h-2 w-full min-w-16 overflow-hidden rounded-full forced-colors:outline forced-colors:outline-1 forced-colors:outline-[color:CanvasText]"
    >
      <rect width={SCALE} height={8} className="fill-muted forced-colors:fill-[color:Canvas]" />
      <rect width={value} height={8} className="fill-destructive forced-colors:fill-[color:Highlight]" />
    </svg>
  );
}
