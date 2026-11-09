import { stripControlChars, type CaseStep, type StepResult } from "@testpulse/shared";
import { buildBugReportTitle, codeSpan, fenceFor, MAX_DESCRIPTION, TRUNCATED } from "./bugReport";
import { caseCode, MANUAL_STATUS_LABEL, runCode } from "./manual";

/** Data run case yang dipakai mengisi deskripsi bug (spec Tahap 4 §5.4); semuanya dari snapshot run, kecuali nama & versi run. */
export interface ManualBugReportSource {
  runNumber: number;
  runName: string;
  appVersion: string | null;
  suiteName: string;
  preconditions: string;
  steps: readonly CaseStep[];
  stepResults: readonly StepResult[];
  note: string;
}

/** Judul awal "TC-12 gagal: {judul case}", dirapikan dan dipotong 200 karakter di batas code point seperti judul dari test CI. */
export function buildManualBugTitle(caseNumber: number, title: string): string {
  return buildBugReportTitle(`${caseCode(caseNumber)} gagal: ${title}`);
}

/** `text` dipotong ke `limit` code unit (tanpa separuh pasangan surrogate) dan diberi penanda; teks yang muat tidak diubah. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let kept = text.slice(0, limit);
  if (/[\ud800-\udbff]$/.test(kept)) kept = kept.slice(0, -1);
  return kept + TRUNCATED;
}

/**
 * Isi satu sel tabel: code span satu baris (atau "–" bila kosong). GFM memecah sel pada `|` sebelum code span diurai,
 * jadi setiap `|` di-escape; deretan backslash tepat sebelumnya digandakan agar `\` milik teks tidak membatalkan escape
 * itu (hasilnya bisa menampilkan backslash ekstra, tetapi sel tidak pernah pecah).
 */
function cell(text: string): string {
  if (text.trim() === "") return "–";
  return codeSpan(text).replace(/(\\*)\|/g, (_, slashes: string) => `${slashes}${slashes}\\|`);
}

/** Blok kode berpagar yang lebih panjang daripada deretan backtick di dalam teks. */
function block(title: string, text: string): string[] {
  const fence = fenceFor(text);
  return ["", `**${title}:**`, "", fence, text, fence];
}

function stepResultLabel(status: StepResult["status"]): string {
  if (status === null) return "Belum diisi";
  // Langkah gagal ditandai ✗ (tidak hanya lewat kata) agar menonjol di tabel.
  return status === "failed" ? `**✗ ${MANUAL_STATUS_LABEL.failed}**` : MANUAL_STATUS_LABEL[status];
}

/** Deskripsi dengan setiap teks bebas (prasyarat, aksi, hasil, catatan) dipotong ke `limit` karakter. */
function render(source: ManualBugReportSource, limit: number): string {
  const lines = [`- **Run:** ${runCode(source.runNumber)} · ${codeSpan(stripControlChars(source.runName))}`];
  if (source.appVersion) lines.push(`- **Versi:** ${codeSpan(stripControlChars(source.appVersion))}`);
  lines.push(`- **Suite:** ${codeSpan(stripControlChars(source.suiteName))}`);

  const preconditions = stripControlChars(source.preconditions);
  if (preconditions.trim() !== "") lines.push(...block("Prasyarat", clip(preconditions, limit)));

  lines.push("", "**Langkah:**", "", "| # | Aksi | Hasil yang diharapkan | Hasil | Catatan |", "| --- | --- | --- | --- | --- |");
  source.steps.forEach((step, index) => {
    const result = source.stepResults[index] ?? { status: null, note: "" };
    const cells = [
      String(index + 1),
      cell(clip(stripControlChars(step.action), limit)),
      cell(clip(stripControlChars(step.expected), limit)),
      stepResultLabel(result.status),
      cell(clip(stripControlChars(result.note), limit)),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  });

  const note = stripControlChars(source.note);
  if (note.trim() !== "") lines.push(...block("Catatan case", clip(note, limit)));
  return lines.join("\n");
}

/**
 * Deskripsi awal bug dari run case gagal (spec Tahap 4 §5.4): run, versi, suite, prasyarat, tabel langkah dengan hasil
 * per langkah (gagal bertanda ✗) dan catatannya, serta catatan case. Teks dari case dianggap tak tepercaya: teks sebaris
 * menjadi code span, teks panjang menjadi blok kode (lihat `bugReport.ts`). Bila melebihi batas server, semua teks bebas
 * dipotong ke panjang maksimum yang sama, diturunkan berulang (pola `buildBugReportDescription`) sampai totalnya muat.
 */
export function buildManualBugDescription(source: ManualBugReportSource): string {
  const texts = [
    source.preconditions,
    source.note,
    ...source.steps.flatMap((step) => [step.action, step.expected]),
    ...source.stepResults.map((result) => result.note),
  ];
  let limit = Math.max(0, ...texts.map((text) => text.length));
  let result = render(source, limit);
  // `limit` turun minimal 1 setiap putaran, jadi loop berakhir; di 0 hanya kerangka tabel yang tersisa (jauh di bawah batas).
  while (result.length > MAX_DESCRIPTION && limit > 0) {
    limit = Math.max(0, Math.min(limit - 1, Math.floor((limit * MAX_DESCRIPTION) / result.length)));
    result = render(source, limit);
  }
  return result;
}
