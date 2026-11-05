import { bugLabel } from "@testpulse/shared";

export const MAX_BUG_LABELS = 10;

/** Kunci error label per indeks (`labels.2`) dipusatkan ke kolom label; kunci lain dipakai apa adanya. */
export function normalizeErrorKey(key: string): string {
  return key.startsWith("labels.") ? "labels" : key;
}

/**
 * Memetakan kunci error `links.<i>[.field]` dari indeks daftar yang dikirim ke indeks baris formulir (baris link yang
 * sama sekali kosong tidak ikut terkirim, jadi indeksnya bergeser). Kunci lain dinormalkan lewat `normalizeErrorKey`.
 */
export function remapLinkKeys(fields: Record<string, string>, rowIndexes: readonly number[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields)) {
    const match = /^links\.(\d+)(\..+)?$/.exec(key);
    const mapped = match ? `links.${rowIndexes[Number(match[1])] ?? match[1]}${match[2] ?? ""}` : normalizeErrorKey(key);
    out[mapped] ??= message;
  }
  return out;
}

export interface AddLabelsResult {
  labels: string[];
  /** Potongan yang belum diterima (mulai dari yang bermasalah), digabung koma; kosong bila semua diterima. */
  rest: string;
  error: string | null;
}

/**
 * Menambahkan label dari potongan teks: tiap potongan dinormalisasi dan divalidasi dengan `bugLabel` (aturan server),
 * duplikat diabaikan tanpa pesan, dan proses berhenti di potongan pertama yang tidak valid atau melewati batas jumlah.
 */
export function addLabels(current: readonly string[], pieces: readonly string[]): AddLabelsResult {
  let labels = [...current];
  for (const [index, raw] of pieces.entries()) {
    if (raw.trim() === "") continue;
    const rest = pieces.slice(index).join(",");
    const parsed = bugLabel.safeParse(raw);
    if (!parsed.success) return { labels, rest, error: parsed.error.issues[0]?.message ?? "Label tidak valid" };
    if (labels.includes(parsed.data)) continue;
    if (labels.length >= MAX_BUG_LABELS) return { labels, rest, error: `Maksimal ${MAX_BUG_LABELS} label` };
    labels = [...labels, parsed.data];
  }
  return { labels, rest: "", error: null };
}
