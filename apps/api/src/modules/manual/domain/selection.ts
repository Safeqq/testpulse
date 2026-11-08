import { MAX_RUN_CASES } from "@testpulse/shared";

type SelectionInput = {
  suites: ReadonlyArray<{ id: string; position: number }>;
  cases: ReadonlyArray<{ id: string; number: number; suiteId: string; archived: boolean }>;
  suiteIds: readonly string[];
  caseNumbers: readonly number[];
};

export type SelectionResult = { ok: true; caseIds: string[] } | { ok: false; field: "suiteIds" | "caseNumbers" | "selection" };

/**
 * Seleksi case untuk run manual (spec §4.2): semua case aktif di suite terpilih ∪ case satuan, tanpa duplikat,
 * diurut posisi suite lalu nomor case. Suite tak dikenal → `suiteIds`; nomor tak dikenal atau diarsipkan → `caseNumbers`;
 * hasil di luar 1–500 → `selection`.
 */
export function selectRunCases(input: SelectionInput): SelectionResult {
  const suitePosition = new Map(input.suites.map((s) => [s.id, s.position]));
  if (!input.suiteIds.every((id) => suitePosition.has(id))) return { ok: false, field: "suiteIds" };

  const byNumber = new Map(input.cases.map((c) => [c.number, c]));
  if (!input.caseNumbers.every((n) => byNumber.get(n)?.archived === false)) return { ok: false, field: "caseNumbers" };

  const chosenSuites = new Set(input.suiteIds);
  const chosenNumbers = new Set(input.caseNumbers);
  const picked = input.cases.filter((c) => !c.archived && (chosenSuites.has(c.suiteId) || chosenNumbers.has(c.number)));

  if (picked.length < 1 || picked.length > MAX_RUN_CASES) return { ok: false, field: "selection" };

  picked.sort((a, b) => suitePosition.get(a.suiteId)! - suitePosition.get(b.suiteId)! || a.number - b.number);
  return { ok: true, caseIds: picked.map((c) => c.id) };
}
