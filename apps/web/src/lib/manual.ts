import {
  caseListQuery,
  manualRunListQuery,
  runCaseListQuery,
  type CaseListQuery,
  type CasePriority,
  type ManualCountsDto,
  type ManualResultStatus,
  type ManualRunListQuery,
  type ManualRunStatus,
  type RunCaseListQuery,
} from "@testpulse/shared";
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

const MAX_CASE_NUMBER = 2_147_483_647;

/** Nomor case dari URL; `null` untuk apa pun yang bukan bilangan bulat positif yang mungkin ada. */
export function parseCaseNumber(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_CASE_NUMBER ? value : null;
}

/** Istilah hasil eksekusi manual (case maupun langkah). */
export const MANUAL_STATUS_LABEL: Record<ManualResultStatus, string> = {
  untested: "Belum dites",
  passed: "Lulus",
  failed: "Gagal",
  blocked: "Diblokir",
  skipped: "Dilewati",
};

/** Status run manual. */
export const MANUAL_RUN_STATUS_LABEL: Record<ManualRunStatus, string> = { open: "Terbuka", completed: "Selesai" };

/** Kode tampil sebuah run manual, mis. `TR-3`. */
export function runCode(number: number): string {
  return `TR-${number}`;
}

/**
 * Legenda progres run: "18/25 dieksekusi · 15 lulus · 2 gagal · 1 diblokir". Hanya status yang punya hitungan yang
 * disebut; yang belum dites tidak ditulis (selisihnya terlihat dari total).
 */
export function runProgressLegend(counts: ManualCountsDto, total: number): string {
  const parts = [
    `${total - counts.untested}/${total} dieksekusi`,
    ...(counts.passed > 0 ? [`${counts.passed} lulus`] : []),
    ...(counts.failed > 0 ? [`${counts.failed} gagal`] : []),
    ...(counts.blocked > 0 ? [`${counts.blocked} diblokir`] : []),
    ...(counts.skipped > 0 ? [`${counts.skipped} dilewati`] : []),
  ];
  return parts.join(" · ");
}

/** Kunci filter daftar run manual di URL. */
export const RUN_FILTER_KEYS = ["status", "appVersion"] as const;

export type RunFilters = Pick<ManualRunListQuery, "status" | "appVersion">;

/** Filter daftar run dari URL; tiap kunci divalidasi sendiri (nilai tidak valid hanya menggugurkan kunci itu). */
export function parseRunFilters(params: URLSearchParams): RunFilters {
  const { shape } = manualRunListQuery;
  const status = shape.status.safeParse(params.get("status") ?? undefined);
  const filters: RunFilters = { status: status.success ? status.data : "all" };
  const appVersion = shape.appVersion.safeParse(params.get("appVersion") ?? undefined);
  if (appVersion.success && appVersion.data !== undefined) filters.appVersion = appVersion.data;
  return filters;
}

/** Kunci filter daftar case dalam satu run di URL. */
export const RUN_CASE_FILTER_KEYS = ["status", "assignee", "suite"] as const;

export type RunCaseFilters = Pick<RunCaseListQuery, "status" | "assignee" | "suite">;

/** Filter daftar case run dari URL; tiap kunci divalidasi sendiri. */
export function parseRunCaseFilters(params: URLSearchParams): RunCaseFilters {
  const { shape } = runCaseListQuery;
  const filters: RunCaseFilters = {};
  const status = shape.status.safeParse(params.get("status") ?? undefined);
  if (status.success && status.data !== undefined) filters.status = status.data;
  const assignee = shape.assignee.safeParse(params.get("assignee") ?? undefined);
  if (assignee.success && assignee.data !== undefined) filters.assignee = assignee.data;
  const suite = shape.suite.safeParse(params.get("suite") ?? undefined);
  if (suite.success && suite.data !== undefined && suite.data !== "") filters.suite = suite.data;
  return filters;
}

/**
 * Jumlah case yang akan disalin ke run baru: case aktif semua suite terpilih ditambah case satuan yang suitenya tidak
 * ikut terpilih (case di suite terpilih sudah terhitung, sama seperti dedupe di server).
 */
export function countSelection(
  suites: readonly { id: string; activeCount: number }[],
  selectedSuiteIds: ReadonlySet<string>,
  picked: readonly { suiteId: string }[],
): number {
  const fromSuites = suites.reduce((sum, suite) => sum + (selectedSuiteIds.has(suite.id) ? suite.activeCount : 0), 0);
  return fromSuites + picked.filter((item) => !selectedSuiteIds.has(item.suiteId)).length;
}

/** Nomor run dari URL; aturannya sama dengan nomor case (bilangan bulat positif yang mungkin ada). */
export const parseRunNumber = parseCaseNumber;

/**
 * Mengelompokkan item run case yang berurutan menurut nama suite snapshot. Server mengurutkan menurut posisi (suite lalu
 * nomor case), jadi case satu suite berdampingan; halaman berikutnya yang melanjutkan suite terakhir menyambung kelompoknya.
 */
export function groupBySuite<T extends { suiteName: string }>(items: readonly T[]): { suiteName: string; items: T[] }[] {
  const groups: { suiteName: string; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.suiteName === item.suiteName) last.items.push(item);
    else groups.push({ suiteName: item.suiteName, items: [item] });
  }
  return groups;
}
