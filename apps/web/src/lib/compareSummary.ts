import type { CompareDto, CompareGroup, RunSummaryDto } from "@testpulse/shared";
import { formatDateTime, formatDuration } from "./format";

export type CompareCounts = CompareDto["summary"];
export type SentenceTone = "warning" | "success" | "neutral";

/** Versi sebagai label: "v1.0.1" untuk "1.0.1"; versi yang tidak diawali angka ("v1.0.1", "release-2") apa adanya. */
export function versionLabel(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}

type LabelledRun = Pick<RunSummaryDto, "id" | "version" | "createdAt">;

/** Label run untuk judul dan kalimat: versinya bila ada, selain itu "run #<8 karakter id> · <tanggal>". */
export function runLabel(run: LabelledRun): string {
  if (run.version !== null) return versionLabel(run.version);
  return `run #${run.id.slice(0, 8)} · ${formatDateTime(run.createdAt)}`;
}

/** Label ringkas untuk baris yang padat: seperti `runLabel`, tetapi run tanpa versi tanpa tanggal ("run #<8 karakter id>"). */
export function shortRunLabel(run: LabelledRun): string {
  return run.version !== null ? versionLabel(run.version) : `run #${run.id.slice(0, 8)}`;
}

/**
 * Label pasangan base/target. Bila keduanya sama (dua run dari versi yang sama) masing-masing diberi " · run #<8 karakter
 * id>" supaya judul, kalimat, dan baris tidak menampilkan "v1.0.0 dibanding v1.0.0".
 */
export function pairLabels(
  base: LabelledRun | null,
  target: LabelledRun,
  style: "full" | "short" = "full",
): { base: string | null; target: string } {
  const label = style === "full" ? runLabel : shortRunLabel;
  const targetLabel = label(target);
  if (base === null) return { base: null, target: targetLabel };
  const baseLabel = label(base);
  if (baseLabel !== targetLabel) return { base: baseLabel, target: targetLabel };
  return {
    base: `${baseLabel} · run #${base.id.slice(0, 8)}`,
    target: `${targetLabel} · run #${target.id.slice(0, 8)}`,
  };
}

export const COMPARE_GROUP_LABEL: Record<CompareGroup, string> = {
  regressions: "Regresi baru",
  fixed: "Diperbaiki",
  stillFailing: "Masih gagal",
  slower: "Lebih lambat",
  added: "Test baru",
  removed: "Test hilang",
};

/** Satu baris untuk kelompok yang kosong; tanda ✓ hanya untuk kabar baik. */
export const COMPARE_GROUP_EMPTY: Record<CompareGroup, string> = {
  regressions: "Tidak ada regresi baru ✓",
  fixed: "Tidak ada test yang diperbaiki",
  stillFailing: "Tidak ada test yang masih gagal ✓",
  slower: "Tidak ada test yang melambat ✓",
  added: "Tidak ada test baru",
  removed: "Tidak ada test yang hilang",
};

interface SentenceInput {
  summary: CompareCounts;
  /** `null` bila tidak ada run pembanding. */
  baseLabel: string | null;
  targetLabel: string;
}

/** Kalimat kesimpulan perbandingan (spec Tahap 3 §4.5); nada menentukan warna kotaknya, ikon ⚠/✓ ada di teks. */
export function compareSentence({ summary, baseLabel, targetLabel }: SentenceInput): { tone: SentenceTone; text: string } {
  if (baseLabel === null) return { tone: "neutral", text: `Belum ada run pembanding untuk ${targetLabel}.` };
  const { regressions, fixed } = summary;
  if (regressions > 0) {
    const head = `⚠ ${targetLabel} punya ${regressions} regresi baru dibanding ${baseLabel}`;
    return {
      tone: "warning",
      text:
        fixed > 0
          ? `${head}, sementara ${fixed} test yang dulu gagal kini lulus. Periksa sebelum rilis.`
          : `${head}. Periksa sebelum rilis.`,
    };
  }
  if (fixed > 0) return { tone: "success", text: `✓ Tidak ada regresi. ${fixed} test yang dulu gagal kini lulus.` };
  return { tone: "success", text: `✓ Tidak ada regresi dibanding ${baseLabel}.` };
}

const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const points = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "1,2 dtk → 3,4 dtk (+183%)"; tanpa persentase bila durasi awal 0. */
export function formatDurationChange(baseMs: number, targetMs: number): string {
  const text = `${formatDuration(baseMs)} → ${formatDuration(targetMs)}`;
  if (baseMs <= 0) return text;
  const percent = Math.round(((targetMs - baseMs) / baseMs) * 100);
  const sign = percent > 0 ? "+" : percent < 0 ? "-" : "";
  return `${text} (${sign}${integer.format(Math.abs(percent))}%)`;
}

/** Perubahan pass rate antarversi dalam poin: "▲ naik 2,1 poin", "▼ turun 4,0 poin", atau "–". */
export function formatPassRateDelta(delta: number | null): { direction: "up" | "down" | "none"; text: string } {
  const rounded = delta === null ? 0 : Math.round(delta * 10) / 10;
  if (rounded > 0) return { direction: "up", text: `▲ naik ${points.format(rounded)} poin` };
  if (rounded < 0) return { direction: "down", text: `▼ turun ${points.format(-rounded)} poin` };
  return { direction: "none", text: "–" };
}
