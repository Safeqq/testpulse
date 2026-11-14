// Urutan versi per branch (spec Tahap 3 §4.2). Tanpa dependency semver; parser linear (tanpa regex bersarang).

export type Semver = {
  // Disimpan sebagai string desimal tanpa nol di depan agar perbandingan tetap tepat untuk angka sebesar apa pun.
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
};

const NUMERIC = /^(0|[1-9][0-9]*)$/;
const IDENTIFIER = /^[0-9A-Za-z-]+$/;
const ALL_DIGITS = /^[0-9]+$/;

/** Cocok dengan `^[vV]?MAJOR.MINOR.PATCH(-prerelease)?(+build)?$`; `+build` dibuang, prefiks `v` diabaikan. */
export function parseSemver(version: string): Semver | null {
  const rest = version.startsWith("v") || version.startsWith("V") ? version.slice(1) : version;

  const plus = rest.indexOf("+");
  const withoutBuild = plus === -1 ? rest : rest.slice(0, plus);
  // Tanpa "+" (plus = -1) yang dicek seluruh versi: setiap versi yang lolos cek inti dan pre-release di bawah juga lolos
  // cek ini (hanya angka, huruf, "-", dan "." tanpa segmen kosong), jadi hasilnya sama dengan melewati cek.
  if (!isDotSeparated(rest.slice(plus + 1))) return null;

  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const prerelease = dash === -1 ? [] : withoutBuild.slice(dash + 1).split(".");

  const numbers = core.split(".");
  if (numbers.length !== 3 || !numbers.every((n) => NUMERIC.test(n))) return null;

  // Identifier numerik tidak boleh berawalan nol (semver 2.0 butir 9). Tanpa pre-release daftarnya kosong (selalu sah).
  const valid = prerelease.every((id) => IDENTIFIER.test(id) && (!ALL_DIGITS.test(id) || NUMERIC.test(id)));
  if (!valid) return null;

  return { major: numbers[0]!, minor: numbers[1]!, patch: numbers[2]!, prerelease };
}

function isDotSeparated(s: string): boolean {
  return s.split(".").every((id) => IDENTIFIER.test(id));
}

function compareNumeric(a: string, b: string): number {
  // Hanya tandanya yang berarti (seperti comparator sort): angka yang lebih pendek lebih kecil.
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareIdentifier(a: string, b: string): number {
  const aNum = ALL_DIGITS.test(a);
  const bNum = ALL_DIGITS.test(b);
  if (aNum && bNum) return compareNumeric(a, b);
  if (aNum) return -1; // identifier numerik < alfanumerik
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0; // urutan ASCII
}

export function compareSemver(a: Semver, b: Semver): number {
  const core = compareNumeric(a.major, b.major) || compareNumeric(a.minor, b.minor) || compareNumeric(a.patch, b.patch);
  if (core !== 0) return core;

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1; // rilis > pre-release
  if (b.prerelease.length === 0) return -1;

  const shared = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < shared; i += 1) {
    const c = compareIdentifier(a.prerelease[i]!, b.prerelease[i]!);
    if (c !== 0) return c;
  }
  // Semua identifier bersama sama: daftar yang lebih pendek lebih kecil, panjang sama berarti setara (tanda saja).
  return a.prerelease.length - b.prerelease.length;
}

/** True bila setiap versi cocok semver. Aturan urutan memakai semver hanya bila ini true. */
export function isAllSemver(versions: Iterable<string>): boolean {
  for (const v of versions) if (parseSemver(v) === null) return false;
  return true;
}

/** Dua versi dianggap sama menurut semver hanya bila semua versi di branch semver; selain itu harus string identik. */
export function sameVersion(a: string, b: string, allSemver: boolean): boolean {
  if (a === b) return true;
  if (!allSemver) return false;
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa !== null && pb !== null && compareSemver(pa, pb) === 0;
}

/** Kunci pengelompokan saja: rilis menjadi `1.0.0-`, tidak pernah bentrok dengan pre-release (identifier-nya tidak kosong). */
function semverKey(s: Semver): string {
  return `${s.major}.${s.minor}.${s.patch}-${s.prerelease.join(".")}`;
}

/**
 * Mengurutkan versi satu branch dari terendah ke tertinggi. Versi yang sama menurut semver digabung
 * menjadi satu entri berlabel string run terbarunya (seri waktu: string yang lebih besar, agar deterministik).
 * Bila ada versi non-semver, semua diurutkan menurut `latestRunAt` dan hanya string identik yang digabung.
 */
export function orderVersions(entries: ReadonlyArray<{ version: string; latestRunAt: Date }>): string[] {
  const parsed = entries.map((e) => ({ ...e, semver: parseSemver(e.version) }));
  const allSemver = parsed.every((e) => e.semver !== null);

  const groups = new Map<string, { label: string; latestRunAt: Date; semver: Semver | null }>();
  for (const e of parsed) {
    const key = allSemver ? semverKey(e.semver!) : e.version;
    const existing = groups.get(key);
    const newer =
      !existing ||
      e.latestRunAt.getTime() > existing.latestRunAt.getTime() ||
      (e.latestRunAt.getTime() === existing.latestRunAt.getTime() &&
        // Stryker disable next-line EqualityOperator: equal strings give the same label either way, so ">" behaves like ">=" (the "<=" mutant is caught by the tie test but cannot be disabled separately).
        e.version > existing.label);
    if (newer) groups.set(key, { label: e.version, latestRunAt: e.latestRunAt, semver: e.semver });
  }

  const merged = [...groups.values()];
  merged.sort((a, b) => {
    if (allSemver) return compareSemver(a.semver!, b.semver!);
    const byTime = a.latestRunAt.getTime() - b.latestRunAt.getTime();
    if (byTime !== 0) return byTime;
    // Stryker disable next-line EqualityOperator: without semver the labels are the distinct map keys, so "<" behaves like "<=" (the ">=" mutant is caught by the tie test but cannot be disabled separately).
    return a.label < b.label ? -1 : 1;
  });
  return merged.map((g) => g.label);
}

/**
 * Run berversi satu branch dikelompokkan per versi, terendah -> tertinggi (aturan `orderVersions`/`sameVersion`).
 * `runs` harus urut lama -> baru; run tiap kelompok mengikuti urutan itu, jadi run terakhir kelompok = "run sebuah
 * versi" (spec §4.2). Run tanpa versi diabaikan. Dipakai bersama oleh pembanding default dan daftar versi.
 */
export function groupRunsByVersion<T extends { version: string | null; createdAt: Date }>(
  runs: ReadonlyArray<T>,
): { groups: { version: string; runs: T[] }[]; allSemver: boolean } {
  const latest = new Map<string, Date>();
  for (const run of runs) if (run.version !== null) latest.set(run.version, run.createdAt);
  const allSemver = isAllSemver(latest.keys());
  const ordered = orderVersions([...latest].map(([version, latestRunAt]) => ({ version, latestRunAt })));
  const groups = ordered.map((version) => ({
    version,
    runs: runs.filter((run) => run.version !== null && sameVersion(run.version, version, allSemver)),
  }));
  return { groups, allSemver };
}
