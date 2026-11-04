import { isAllSemver, orderVersions, sameVersion } from "./versions.js";

export type RunRef = { id: string; createdAt: Date; version: string | null };

/** Versi terurut (terendah -> tertinggi) dari run bervisi di branch, plus apakah aturan semver berlaku. */
function versionOrder(branchRuns: ReadonlyArray<RunRef>): { ordered: string[]; allSemver: boolean } {
  // `branchRuns` urut lama -> baru, jadi kemunculan terakhir sebuah string versi adalah run terakhirnya.
  const latest = new Map<string, Date>();
  for (const r of branchRuns) if (r.version !== null) latest.set(r.version, r.createdAt);
  const entries = [...latest].map(([version, latestRunAt]) => ({ version, latestRunAt }));
  return { ordered: orderVersions(entries), allSemver: isAllSemver(latest.keys()) };
}

function lastRunOfVersion(branchRuns: ReadonlyArray<RunRef>, version: string, allSemver: boolean): RunRef | null {
  for (let i = branchRuns.length - 1; i >= 0; i -= 1) {
    const r = branchRuns[i]!;
    if (r.version !== null && sameVersion(r.version, version, allSemver)) return r;
  }
  return null;
}

/**
 * Pembanding default untuk `target` (spec §4.3). `branchRuns` = semua run branch target, urut lama -> baru,
 * termasuk target. 1) run terakhir dari versi tepat di bawah versi target; 2) run tepat sebelum target
 * (juga bila target tidak berversi atau versinya terendah); 3) `null`.
 */
export function pickBaseline(target: RunRef, branchRuns: ReadonlyArray<RunRef>): RunRef | null {
  if (target.version !== null) {
    const { ordered, allSemver } = versionOrder(branchRuns);
    const position = ordered.findIndex((v) => sameVersion(v, target.version!, allSemver));
    if (position > 0) {
      const below = lastRunOfVersion(branchRuns, ordered[position - 1]!, allSemver);
      if (below) return below;
    }
  }

  const index = branchRuns.findIndex((r) => r.id === target.id);
  return index > 0 ? branchRuns[index - 1]! : null;
}

/** Target default tanpa parameter: run terakhir dari versi tertinggi (bila ada versi), selain itu run terakhir branch. */
export function pickDefaultTarget(branchRuns: ReadonlyArray<RunRef>): RunRef | null {
  const { ordered, allSemver } = versionOrder(branchRuns);
  const highest = ordered[ordered.length - 1];
  if (highest !== undefined) return lastRunOfVersion(branchRuns, highest, allSemver);
  return branchRuns[branchRuns.length - 1] ?? null;
}
