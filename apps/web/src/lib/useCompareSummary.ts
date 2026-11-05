import type { CompareDto } from "@testpulse/shared";
import { useCallback } from "react";
import { api, type CompareParams } from "./api";
import { useLoad, type LoadState } from "./useLoad";

/** Ringkasan angka sebuah perbandingan (tanpa daftar test: `groups=none`) untuk kartu dashboard dan panel detail run. */
export function useCompareSummary(
  slug: string,
  pair: { target?: string; branch?: string },
): LoadState<CompareDto> & { reload: () => void } {
  const { target, branch } = pair;
  const fetchSummary = useCallback(() => {
    const query: CompareParams = { groups: "none" };
    if (target) query.target = target;
    if (branch) query.branch = branch;
    return api.results.compare(slug, query);
  }, [slug, target, branch]);
  return useLoad(fetchSummary);
}
