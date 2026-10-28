import type { StatsDto } from "@testpulse/shared";
import { useEffect, useRef, useState, type RefObject } from "react";
import { formatDateTime, formatDuration, formatPassRate, formatShortDate } from "../../lib/format";

type Point = StatsDto["points"][number];

const HEIGHT = 180;
const MARGIN = { top: 12, right: 16, bottom: 26, left: 44 };
const GRID_LINES = [0, 50, 100] as const;

/** Mengikuti lebar kontainer agar teks sumbu selalu berukuran asli (viewBox 1:1 dengan piksel layar). */
function useContainerWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(200, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function summarize(points: Point[]): string {
  const rates = points.flatMap((p) => (p.passRate === null ? [] : [p.passRate]));
  const head = `Grafik tren pass rate ${points.length} run terakhir.`;
  if (rates.length === 0) return `${head} Tidak ada data pass rate.`;
  const latest = points.at(-1)?.passRate ?? null;
  return `${head} Terbaru ${formatPassRate(latest)}, terendah ${formatPassRate(Math.min(...rates))}, tertinggi ${formatPassRate(Math.max(...rates))}.`;
}

/**
 * Tren pass rate per run (terlama → terbaru) sebagai SVG murni. Warna lewat kelas utilitas (token tema), tanpa atribut
 * `style` (CSP). Alternatif teks: `aria-label` ringkasan dan tabel `sr-only`.
 */
export function TrendChart({ points }: { points: StatsDto["points"] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) =>
    points.length === 1 ? MARGIN.left + innerWidth / 2 : MARGIN.left + (innerWidth * index) / (points.length - 1);
  const y = (rate: number) => MARGIN.top + innerHeight * (1 - rate / 100);

  // Run tanpa pass rate (semua dilewati) memutus garis alih-alih ditarik ke nol.
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((point, index) => {
    if (point.passRate === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ x: x(index), y: y(point.passRate) });
    }
  });
  if (current.length > 0) segments.push(current);

  const first = points[0];
  const last = points.at(-1);

  return (
    <div ref={containerRef} className="min-w-0" data-testid="trend-chart">
      <svg
        role="img"
        aria-label={summarize(points)}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block h-auto w-full"
      >
        {GRID_LINES.map((value) => (
          <g key={value}>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(value)}
              y2={y(value)}
              strokeWidth={1}
              className="stroke-border forced-colors:stroke-[color:GrayText]"
            />
            <text
              x={MARGIN.left - 8}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-xs forced-colors:fill-[color:CanvasText]"
            >
              {value}%
            </text>
          </g>
        ))}

        {segments.map((segment) =>
          segment.length > 1 ? (
            <polyline
              key={`${segment[0]!.x}`}
              points={segment.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-link forced-colors:stroke-[color:CanvasText]"
            />
          ) : null,
        )}

        {points.map((point, index) =>
          point.passRate === null ? null : (
            <circle
              key={point.runId}
              cx={x(index)}
              cy={y(point.passRate)}
              r={4}
              strokeWidth={2}
              className="fill-card stroke-link forced-colors:fill-[color:Canvas] forced-colors:stroke-[color:CanvasText]"
            >
              <title>{`${formatDateTime(point.createdAt)}: ${formatPassRate(point.passRate)}`}</title>
            </circle>
          ),
        )}

        {first && last ? (
          points.length === 1 ? (
            <text
              x={x(0)}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-xs forced-colors:fill-[color:CanvasText]"
            >
              {formatShortDate(first.createdAt)}
            </text>
          ) : (
            <>
              <text
                x={MARGIN.left}
                y={HEIGHT - 6}
                textAnchor="start"
                className="fill-muted-foreground text-xs forced-colors:fill-[color:CanvasText]"
              >
                {formatShortDate(first.createdAt)}
              </text>
              <text
                x={width - MARGIN.right}
                y={HEIGHT - 6}
                textAnchor="end"
                className="fill-muted-foreground text-xs forced-colors:fill-[color:CanvasText]"
              >
                {formatShortDate(last.createdAt)}
              </text>
            </>
          )
        ) : null}
      </svg>

      {/* Pembungkus sr-only: tabel sendiri tidak menghormati width/overflow sr-only dan melebarkan halaman. */}
      <div className="sr-only">
        <table>
          <caption>Pass rate per run, dari yang terlama ke yang terbaru</caption>
          <thead>
            <tr>
              <th scope="col">Waktu</th>
              <th scope="col">Pass rate</th>
              <th scope="col">Durasi</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.runId}>
                <td>{formatDateTime(point.createdAt)}</td>
                <td>{formatPassRate(point.passRate)}</td>
                <td>{formatDuration(point.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
