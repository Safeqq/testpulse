import {
  branchName,
  COMPARE_GROUPS,
  compareQuery,
  type BugRefDto,
  type CompareDto,
  type CompareGroup,
  type CompareGroupPageDto,
  type CompareItemDto,
  type CompareQuery,
  type VersionDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withStatementTimeout, type Queryable } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import {
  listBranchRuns,
  listCompareResults,
  listResultMessages,
  messageKey,
  type CompareResultRow,
} from "./compare.repository.js";
import { decodeCompareCursor, encodeCompareCursor, type CompareKey } from "./cursor.js";
import { pickBaseline, pickDefaultTarget } from "./domain/baseline.js";
import { classify, type CompareMatch } from "./domain/compare.js";
import { groupRunsByVersion } from "./domain/versions.js";
import {
  invalidCursor,
  passRate,
  READ_STATEMENT_TIMEOUT_MS,
  runNotFound,
  toRunSummary,
  type ReadRoutesOptions,
} from "./read.routes.js";
import { bugRefsForTests, findRun, latestBranch, type RunRecord } from "./repository.js";

/** Batas daftar (spec Tahap 3 §6): 200 item pertama per kelompok, lalu 100 per halaman; maks 100 versi. */
export const COMPARE_FIRST_PAGE = 200;
export const COMPARE_PAGE_SIZE = 100;
export const MAX_VERSIONS = 100;

const versionsQuery = z.object({ branch: branchName.optional() });

function sameRun(): AppError {
  return new AppError(400, "VALIDATION_ERROR", "Data tidak valid", {
    base: "Run pembanding tidak boleh sama dengan run target",
  });
}

/** Cursor dari halaman perbandingan lain (run base/target berbeda, mis. ada upload baru di antara halaman). */
function staleCursor(): AppError {
  return new AppError(400, "VALIDATION_ERROR", "Data tidak valid", {
    cursor: "Cursor tidak berlaku untuk perbandingan ini. Muat ulang perbandingan",
  });
}

/**
 * Versi satu branch (spec §4.2), tertinggi dulu. "Run sebuah versi" = run terakhirnya; versi yang sama menurut
 * semver (mis. `v1.0.1` dan `1.0.1`) menjadi satu entri. `passRateDelta` = selisih poin terhadap versi tepat di
 * bawahnya, `null` bila tidak ada versi di bawahnya atau salah satu pass rate `null`.
 */
function listVersions(branchRuns: readonly RunRecord[]): VersionDto[] {
  const rows = groupRunsByVersion(branchRuns).groups.map((group) => {
    const run = group.runs.at(-1)!;
    return { version: group.version, run, runCount: group.runs.length, passRate: passRate(run) };
  });

  return rows
    .map((row, index): VersionDto => {
      const below = rows[index - 1];
      const delta =
        below === undefined || row.passRate === null || below.passRate === null
          ? null
          : Math.round((row.passRate - below.passRate) * 10) / 10;
      return { ...row, run: toRunSummary(row.run), passRateDelta: delta };
    })
    .toReversed();
}

/** Satu test dalam kelompok perbandingan, dengan data base/target lengkap untuk DTO. */
interface CompareEntry extends CompareKey {
  base: CompareResultRow | null;
  target: CompareResultRow | null;
}

/** Urutan code unit (deterministik, tidak bergantung collation database): suite, nama, lalu id test. */
function compareKeys(a: CompareKey, b: CompareKey): number {
  if (a.suite !== b.suite) return a.suite < b.suite ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.testCaseId !== b.testCaseId) return a.testCaseId < b.testCaseId ? -1 : 1;
  return 0;
}

/** Hasil `classify` diperkaya dengan baris lengkap kedua run, tiap kelompok diurutkan `compareKeys`. */
function groupEntries(
  baseRows: CompareResultRow[],
  targetRows: CompareResultRow[],
): Record<CompareGroup, CompareEntry[]> {
  const baseById = new Map(baseRows.map((row) => [row.testCaseId, row]));
  const targetById = new Map(targetRows.map((row) => [row.testCaseId, row]));
  const toEntry = (match: CompareMatch): CompareEntry => {
    const base = baseById.get(match.testCaseId) ?? null;
    const target = targetById.get(match.testCaseId) ?? null;
    const identity = (target ?? base)!;
    return { testCaseId: match.testCaseId, suite: identity.suite, name: identity.name, base, target };
  };
  const groups = classify(baseRows, targetRows);
  const sorted = (matches: CompareMatch[]) => matches.map(toEntry).sort(compareKeys);
  return {
    regressions: sorted(groups.regressions),
    fixed: sorted(groups.fixed),
    stillFailing: sorted(groups.stillFailing),
    slower: sorted(groups.slower),
    added: sorted(groups.added),
    removed: sorted(groups.removed),
  };
}

interface EntryPage {
  entries: CompareEntry[];
  nextCursor: string | null;
}

/**
 * `size` item setelah posisi `after` (atau dari awal); `nextCursor` = kunci item terakhir (terikat pada pasangan run
 * `pair`) bila masih ada sisa.
 */
function pageOf(
  entries: CompareEntry[],
  after: CompareKey | undefined,
  size: number,
  pair: { baseId: string; targetId: string },
): EntryPage {
  const found = after === undefined ? 0 : entries.findIndex((entry) => compareKeys(entry, after) > 0);
  const start = found === -1 ? entries.length : found;
  const page = entries.slice(start, start + size);
  const last = page.at(-1);
  return {
    entries: page,
    nextCursor:
      start + size < entries.length && last
        ? encodeCompareCursor({ ...pair, suite: last.suite, name: last.name, testCaseId: last.testCaseId })
        : null,
  };
}

const toSide = (row: CompareResultRow | null, message: string | null) =>
  row === null ? null : { status: row.status, durationMs: row.durationMs, message, flakyInRun: row.flakyInRun };

/**
 * Daftar versi dan perbandingan dua run (spec Tahap 3 §4.2–4.4, §6). Sama seperti rute baca hasil: hanya sesi
 * cookie (token CI = anonim), akses project diputuskan sebelum query divalidasi, dan query berjalan dalam transaksi
 * baca-saja ber-`statement_timeout`.
 */
export async function compareRoutes(app: FastifyInstance, opts: ReadRoutesOptions = {}): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;
  const heavyRead = <T>(fn: (db: Queryable) => Promise<T>) => withStatementTimeout(app.db, statementTimeoutMs, fn);

  app.get<{ Params: { slug: string } }>("/projects/:slug/versions", readAccess, async (req): Promise<VersionDto[]> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const requested = parseOrThrow(versionsQuery, req.query).branch;
    const branchRuns = await heavyRead(async (db) => {
      const branch = requested ?? (await latestBranch(db, project.id));
      return branch === null ? [] : listBranchRuns(db, project.id, branch);
    });
    return listVersions(branchRuns).slice(0, MAX_VERSIONS);
  });

  /**
   * Run base & target (spec §4.3). Target eksplisit, atau target default di `branch` (default: branch run terbaru).
   * Base eksplisit (boleh dari branch lain), atau pembanding default dari semua run branch target.
   */
  async function resolvePair(db: Queryable, projectId: string, query: CompareQuery) {
    const findOrThrow = async (id: string) => {
      const run = await findRun(db, projectId, id);
      if (!run) throw runNotFound();
      return run;
    };
    const explicitBase = query.base === undefined ? null : await findOrThrow(query.base);

    let target: RunRecord | null;
    let branchRuns: RunRecord[] | null = null;
    if (query.target !== undefined) {
      target = await findOrThrow(query.target);
    } else {
      const branch = query.branch ?? (await latestBranch(db, projectId));
      branchRuns = branch === null ? [] : await listBranchRuns(db, projectId, branch);
      target = pickDefaultTarget(branchRuns);
    }

    if (explicitBase !== null) {
      if (target !== null && explicitBase.id === target.id) throw sameRun();
      return { base: explicitBase, target };
    }
    if (target === null) return { base: null, target: null };
    branchRuns ??= await listBranchRuns(db, projectId, target.branch);
    return { base: pickBaseline(target, branchRuns), target };
  }

  app.get<{ Params: { slug: string } }>(
    "/projects/:slug/compare",
    readAccess,
    async (req): Promise<CompareDto | CompareGroupPageDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const query = parseOrThrow(compareQuery, req.query);
      const after = query.cursor === undefined ? undefined : decodeCompareCursor(query.cursor);
      if (after === null) throw invalidCursor();
      // Id run berbentuk lain tidak mungkin ada (dan akan ditolak Postgres saat bind).
      for (const id of [query.base, query.target]) if (id !== undefined && !isUuid(id)) throw runNotFound();

      const { base, target, groups, pages, bugs, messages } = await heavyRead(async (db) => {
        const pair = await resolvePair(db, project.id, query);
        // Cursor hanya berlaku untuk pasangan run tempat ia dibuat (default bisa bergeser setelah upload baru).
        if (after !== undefined && (pair.base?.id !== after.baseId || pair.target?.id !== after.targetId)) {
          throw staleCursor();
        }
        if (pair.base === null || pair.target === null) {
          return {
            ...pair,
            groups: null,
            pages: new Map<CompareGroup, EntryPage>(),
            bugs: new Map<string, BugRefDto[]>(),
            messages: new Map<string, string>(),
          };
        }

        const grouped = groupEntries(
          await listCompareResults(db, pair.base.id),
          await listCompareResults(db, pair.target.id),
        );
        // Respons utama: 200 item pertama tiap kelompok; `group` (+ `cursor`): 100 item satu kelompok;
        // `groups=none`: hanya ringkasan angka, tanpa item sehingga pesan dan badge bug tidak perlu dibaca.
        if (query.groups === "none") {
          return {
            ...pair,
            groups: grouped,
            pages: new Map<CompareGroup, EntryPage>(),
            bugs: new Map<string, BugRefDto[]>(),
            messages: new Map<string, string>(),
          };
        }
        const selected = query.group === undefined ? COMPARE_GROUPS : [query.group];
        const size = query.group === undefined ? COMPARE_FIRST_PAGE : COMPARE_PAGE_SIZE;
        const ids = { baseId: pair.base.id, targetId: pair.target.id };
        const paged = new Map(selected.map((group) => [group, pageOf(grouped[group], after, size, ids)] as const));
        const shown = [...paged.values()].flatMap((page) => page.entries);
        // Pesan (bisa panjang) hanya untuk item yang dikembalikan: satu query untuk kedua sisi.
        const messageRows = await listResultMessages(db, [
          { runId: pair.base.id, testCaseIds: shown.filter((entry) => entry.base !== null).map((entry) => entry.testCaseId) },
          { runId: pair.target.id, testCaseIds: shown.filter((entry) => entry.target !== null).map((entry) => entry.testCaseId) },
        ]);
        return {
          ...pair,
          groups: grouped,
          pages: paged,
          bugs: await bugRefsForTests(
            db,
            project.id,
            shown.map((entry) => entry.testCaseId),
          ),
          messages: messageRows,
        };
      });

      const messageOf = (run: RunRecord | null, testCaseId: string) =>
        run === null ? null : (messages.get(messageKey(run.id, testCaseId)) ?? null);
      const toPage = (group: CompareGroup): CompareGroupPageDto => {
        const page = pages.get(group);
        return {
          items: (page?.entries ?? []).map(
            (entry): CompareItemDto => ({
              testCaseId: entry.testCaseId,
              suite: entry.suite,
              name: entry.name,
              base: toSide(entry.base, messageOf(base, entry.testCaseId)),
              target: toSide(entry.target, messageOf(target, entry.testCaseId)),
              bugs: bugs.get(entry.testCaseId) ?? [],
            }),
          ),
          nextCursor: page?.nextCursor ?? null,
        };
      };

      if (query.group !== undefined) return toPage(query.group);

      const count = (group: CompareGroup) => groups?.[group].length ?? 0;
      return {
        base: base === null ? null : toRunSummary(base),
        target: target === null ? null : toRunSummary(target),
        summary: {
          regressions: count("regressions"),
          fixed: count("fixed"),
          stillFailing: count("stillFailing"),
          slower: count("slower"),
          added: count("added"),
          removed: count("removed"),
        },
        groups: {
          regressions: toPage("regressions"),
          fixed: toPage("fixed"),
          stillFailing: toPage("stillFailing"),
          slower: toPage("slower"),
          added: toPage("added"),
          removed: toPage("removed"),
        },
      };
    },
  );
}
