import { groupRunsByVersion, sameVersion } from "./versions.js";

export type RunRef = { id: string; createdAt: Date; version: string | null };

/**
 * Pembanding default untuk `target` (spec §4.3). `branchRuns` = semua run branch target, urut lama -> baru,
 * termasuk target. 1) run terakhir dari versi tepat di bawah versi target; 2) run tepat sebelum target
 * (juga bila target tidak berversi atau versinya terendah); 3) `null`.
 */
export function pickBaseline<T extends RunRef>(target: RunRef, branchRuns: ReadonlyArray<T>): T | null {
  if (target.version !== null) {
    const { groups, allSemver } = groupRunsByVersion(branchRuns);
    const position = groups.findIndex((g) => sameVersion(g.version, target.version!, allSemver));
    const below = position > 0 ? groups[position - 1]!.runs.at(-1) : undefined;
    if (below) return below;
  }

  const index = branchRuns.findIndex((r) => r.id === target.id);
  return index > 0 ? branchRuns[index - 1]! : null;
}

/** Target default tanpa parameter: run terakhir dari versi tertinggi (bila ada versi), selain itu run terakhir branch. */
export function pickDefaultTarget<T extends RunRef>(branchRuns: ReadonlyArray<T>): T | null {
  const highest = groupRunsByVersion(branchRuns).groups.at(-1);
  return highest?.runs.at(-1) ?? branchRuns.at(-1) ?? null;
}
