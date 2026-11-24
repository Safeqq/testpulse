import { clipCodePoints, codeSpan, safeAutolink, stripControlChars } from "@testpulse/shared";

// Spec Tahap 5 §5.4: deskripsi bug dibuat server dari laporan crowd yang diterima.

export const MAX_BUG_DESCRIPTION = 20_000;
const TRUNCATED = "… (dipotong)";

export interface CrowdBugDescriptionInput {
  reportNumber: number;
  cycleNumber: number;
  cycleTitle: string;
  reporterName: string;
  environment: string;
  steps: string;
  expected: string;
  actual: string;
  links: readonly string[];
}

function section(title: string, body: string): string[] {
  return ["", `### ${title}`, "", body];
}

/**
 * Metadata (nomor, cycle, pelapor, lingkungan) ditulis pertama sebagai code span sehingga teks crowd di dalamnya tidak
 * bisa membentuk tautan atau judul, dan isi laporan di bawahnya tidak bisa menimpanya. Langkah, hasil yang diharapkan,
 * dan yang terjadi disalin sebagai Markdown (dirender aman oleh renderer web). Link bukti hanya ditulis sebagai
 * autolink http(s) yang bersih. Isi yang terlalu panjang dipotong (langkah dulu, lalu yang lain) sampai muat batas
 * deskripsi bug, tanpa separuh pasangan surrogate.
 */
export function buildCrowdBugDescription(input: CrowdBugDescriptionInput): string {
  const head = [
    `- **Laporan crowdtesting:** ${codeSpan(`CR-${input.reportNumber}`)} di cycle ${codeSpan(`CY-${input.cycleNumber}`)} · ${codeSpan(stripControlChars(input.cycleTitle))}`,
    `- **Pelapor:** ${codeSpan(stripControlChars(input.reporterName))}`,
    `- **Lingkungan:** ${codeSpan(stripControlChars(input.environment))}`,
  ];
  const links = input.links.map((url) => safeAutolink(stripControlChars(url))).filter((l): l is string => l !== null);
  const tail = links.length === 0 ? [] : section("Link bukti", links.map((l) => `- ${l}`).join("\n"));

  const bodies = [stripControlChars(input.steps), stripControlChars(input.expected), stripControlChars(input.actual)];
  const assemble = (parts: string[]) =>
    [
      ...head,
      ...section("Langkah reproduksi", parts[0]!),
      ...section("Hasil yang diharapkan", parts[1]!),
      ...section("Yang terjadi", parts[2]!),
      ...tail,
    ].join("\n");

  let result = assemble(bodies);
  // Memotong bagian satu per satu sebanyak kelebihannya; setiap putaran memendekkan teks, jadi loop ini berakhir.
  for (let i = 0; i < bodies.length && result.length > MAX_BUG_DESCRIPTION; i++) {
    const excess = result.length - MAX_BUG_DESCRIPTION;
    const original = bodies[i]!;
    const keep = Math.max(0, original.length - excess - TRUNCATED.length);
    bodies[i] = clipCodePoints(original, keep) + TRUNCATED;
    result = assemble(bodies);
  }
  return result;
}
