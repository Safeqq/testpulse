import { compareSemver, isAllSemver, orderVersions, parseSemver, sameVersion } from "../../results/domain/versions.js";

type ManualVersionEntry = { appVersion: string; latestAt: Date };

/**
 * Menggabungkan versi automated sebuah branch dengan versi run manual (spec §5.1 langkah 1–3).
 * Hasil terendah → tertinggi; pemanggil yang membalik urutan dan memotong ke 100 baris.
 *
 * - Versi manual yang sama dengan versi automated (berpasangan: semver bila keduanya semver, selain itu string
 *   identik) tidak menjadi baris baru.
 * - Versi manual-saja disisipkan menurut semver bila versi automated dan semua versi manual-saja semver;
 *   selain itu ditaruh di bawah semua versi automated, berurut waktu run manual terbarunya.
 *
 * `matchOf(v)` mengembalikan label baris tempat versi manual `v` berada (versi automated yang cocok, atau baris
 * manual-saja), atau `null` bila `v` tidak termasuk versi manual yang diberikan.
 */
export function mergeManualVersions(input: {
  automated: readonly string[];
  manual: readonly ManualVersionEntry[];
}): { rows: Array<{ version: string; automated: boolean }>; matchOf: (manualVersion: string) => string | null } {
  const automatedSemver = isAllSemver(input.automated);
  // Pencocokan berpasangan (spec §5.1): semver bila keduanya semver, selain itu string identik.
  const findAutomated = (version: string) => input.automated.find((a) => sameVersion(a, version, true));

  const manualOnly = input.manual.filter((m) => findAutomated(m.appVersion) === undefined);
  const entries = manualOnly.map((m) => ({ version: m.appVersion, latestRunAt: m.latestAt }));
  const interleave = automatedSemver && isAllSemver(entries.map((e) => e.version));

  const manualRows = interleave ? orderVersions(entries) : orderByLatest(entries);
  const automatedRows = input.automated.map((version) => ({ version, automated: true }));
  const onlyRows = manualRows.map((version) => ({ version, automated: false }));

  const rows = interleave ? interleaveSemver(automatedRows, onlyRows) : [...onlyRows, ...automatedRows];

  const manualOnlyMatch = (version: string) => manualRows.find((row) => sameVersion(row, version, interleave));
  const knownManual = new Set(input.manual.map((m) => m.appVersion));
  const matchOf = (manualVersion: string): string | null => {
    if (!knownManual.has(manualVersion)) return null;
    return findAutomated(manualVersion) ?? manualOnlyMatch(manualVersion) ?? null;
  };

  return { rows, matchOf };
}

/** Versi manual-saja non-semver: string identik digabung, urut waktu terbaru naik (string untuk seri waktu). */
function orderByLatest(entries: ReadonlyArray<{ version: string; latestRunAt: Date }>): string[] {
  const latest = new Map<string, number>();
  for (const e of entries) latest.set(e.version, Math.max(latest.get(e.version) ?? -Infinity, e.latestRunAt.getTime()));
  return [...latest]
    .sort(([va, ta], [vb, tb]) => ta - tb || (va < vb ? -1 : va > vb ? 1 : 0))
    .map(([version]) => version);
}

/** Menyisipkan baris manual-saja ke daftar automated; keduanya hanya berisi semver yang berbeda. */
function interleaveSemver(
  automated: Array<{ version: string; automated: boolean }>,
  manualOnly: Array<{ version: string; automated: boolean }>,
): Array<{ version: string; automated: boolean }> {
  const parsed = (version: string) => parseSemver(version)!;
  return [...automated, ...manualOnly].sort((a, b) => compareSemver(parsed(a.version), parsed(b.version)));
}
