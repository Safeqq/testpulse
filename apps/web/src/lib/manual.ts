import { caseListQuery, type CaseListQuery, type CasePriority } from "@testpulse/shared";
import { BUG_PRIORITY_LABEL } from "./bugs";

/** Prioritas case memakai himpunan dan istilah yang sama dengan prioritas bug. */
export const CASE_PRIORITY_LABEL: Record<CasePriority, string> = BUG_PRIORITY_LABEL;

export const AUTOMATED_LABEL = { yes: "Sudah diotomasi", no: "Belum diotomasi" } as const;

/** Kode tampil sebuah case, mis. `TC-12`. */
export function caseCode(number: number): string {
  return `TC-${number}`;
}

/** Kunci filter daftar case di URL (`archived` hanya ditulis bila `true`). */
export const CASE_FILTER_KEYS = ["suite", "q", "priority", "label", "automated", "archived"] as const;

export type CaseFilters = Pick<CaseListQuery, "suite" | "q" | "priority" | "label" | "automated" | "archived">;

/**
 * Filter daftar case dari URL. Tiap kunci divalidasi sendiri dengan skema bersama: nilai yang tidak valid (mis. hasil
 * suntingan manual) hanya menggugurkan kunci itu, filter lain tetap berlaku.
 */
export function parseCaseFilters(params: URLSearchParams): CaseFilters {
  const { shape } = caseListQuery;
  const archived = shape.archived.safeParse(params.get("archived") ?? undefined);
  const filters: CaseFilters = { archived: archived.success ? archived.data : "false" };
  const suite = shape.suite.safeParse(params.get("suite") ?? undefined);
  if (suite.success && suite.data !== undefined) filters.suite = suite.data;
  const q = shape.q.safeParse(params.get("q") ?? undefined);
  if (q.success && q.data !== undefined) filters.q = q.data;
  const priority = shape.priority.safeParse(params.get("priority") ?? undefined);
  if (priority.success && priority.data !== undefined) filters.priority = priority.data;
  const label = shape.label.safeParse(params.get("label") ?? undefined);
  if (label.success && label.data !== undefined) filters.label = label.data;
  const automated = shape.automated.safeParse(params.get("automated") ?? undefined);
  if (automated.success && automated.data !== undefined) filters.automated = automated.data;
  return filters;
}
