import {
  branchName,
  COMPARE_GROUPS,
  compareQuery,
  MAX_VERSIONS,
  type BugRefDto,
  type CompareDto,
  type CompareGroup,
  type CompareGroupPageDto,
  type CompareItemDto,
  type CompareQuery,
  type ManualCountsDto,
  type ManualRunRefDto,
  type VersionDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withStatementTimeout, type Queryable } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser } from "../auth/service.js";
import { mergeManualVersions } from "../manual/domain/versions.js";
import { summarize } from "../manual/domain/summary.js";
import { countsByRun } from "../manual/runs.repository.js";
import { resolveProject } from "../projects/access.js";
import {
  listBranchRuns,
  listCompareResults,
  listLatestManualRunsByVersion,
  listResultMessages,
  messageKey,
  type CompareResultRow,
  type ManualVersionRun,
} from "./compare.repository.js";
import { decodeCompareCursor, encodeCompareCursor, type CompareKey } from "./cursor.js";
import { pickBaseline, pickDefaultTarget } from "./domain/baseline.js";
import { classify, type CompareMatch } from "./domain/compare.js";
import { groupRunsByVersion } from "./domain/versions.js";
import { LruCache } from "./lru-cache.js";
import {
  invalidCursor,
  passRate,
  READ_STATEMENT_TIMEOUT_MS,
  runNotFound,
  toRunSummary,
  type ReadRoutesOptions,
} from "./read.routes.js";
import { bugRefsForTests, findRun, latestBranch, type RunRecord } from "./repository.js";

/** Batas daftar (spec Tahap 3 §6): 200 item pertama per kelompok, lalu 100 per halaman; maks `MAX_VERSIONS` versi. */
export const COMPARE_FIRST_PAGE = 200;
export const COMPARE_PAGE_SIZE = 100;
/** Jumlah ringkasan perbandingan (`groups=none`) yang disimpan di cache memori (Ruling F-b). */
export const COMPARE_SUMMARY_CACHE_SIZE = 500;

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

type AutomatedVersion = Omit<VersionDto, "manual">;

/**
 * Versi satu branch (spec §4.2), tertinggi dulu. "Run sebuah versi" = run terakhirnya; versi yang sama menurut
 * semver (mis. `v1.0.1` dan `1.0.1`) menjadi satu entri. `passRateDelta` = selisih poin terhadap versi tepat di
 * bawahnya, `null` bila tidak ada versi di bawahnya atau salah satu pass rate `null`.
 */
function listVersions(branchRuns: readonly RunRecord[]): AutomatedVersion[] {
  const rows = groupRunsByVersion(branchRuns).groups.map((group) => {
    const run = group.runs.at(-1)!;
    return { version: group.version, run, runCount: group.runs.length, passRate: passRate(run) };
  });

  return rows
    .map((row, index): AutomatedVersion => {
      const below = rows[index - 1];
      const delta =
        below === undefined || row.passRate === null || below.passRate === null
          ? null
          : Math.round((row.passRate - below.passRate) * 10) / 10;
      return { ...row, run: toRunSummary(row.run), passRateDelta: delta };
    })
    .toReversed();
}

/**
 * Menggabungkan versi automated (tertinggi dulu, `passRateDelta` sudah dihitung antarversi automated) dengan run
 * manual terbaru per versi (Tahap 4 §5.1): penempatan baris manual-saja oleh `mergeManualVersions`, lalu dipotong
 * `MAX_VERSIONS` baris tertinggi. Tiap baris mendapat run manual bernomor terbesar di antara versi manual yang
 * jatuh ke baris itu (beberapa penulisan, mis. `v0.4.0` dan `0.4.0`, bisa jatuh ke satu baris).
 */
function mergeVersions(
  automated: readonly AutomatedVersion[],
  manualRuns: readonly ManualVersionRun[],
): Array<{ automated: AutomatedVersion | null; version: string; manualRun: ManualVersionRun | null }> {
  const { rows, matchOf } = mergeManualVersions({
    automated: automated.map((entry) => entry.version).toReversed(),
    manual: manualRuns.map((run) => ({ appVersion: run.appVersion, latestAt: run.createdAt })),
  });
  const manualByRow = new Map<string, ManualVersionRun>();
  for (const run of manualRuns) {
    const label = matchOf(run.appVersion);
    const current = label === null ? undefined : manualByRow.get(label);
    if (label !== null && (current === undefined || run.number > current.number)) manualByRow.set(label, run);
  }
  const automatedByVersion = new Map(automated.map((entry) => [entry.version, entry]));
  return rows
    .toReversed()
    .slice(0, MAX_VERSIONS)
    .map((row) => ({
      automated: row.automated ? (automatedByVersion.get(row.version) ?? null) : null,
      version: row.version,
      manualRun: manualByRow.get(row.version) ?? null,
    }));
}

const toManualRef = (run: ManualVersionRun, counts: Partial<ManualCountsDto>): ManualRunRefDto => {
  const { total, counts: full } = summarize(counts);
  return { number: run.number, name: run.name, status: run.status, total, counts: full };
};

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

  /**
   * Ringkasan `groups=none` (kartu dashboard) per (project, base, target), Ruling F-b: hasil run tidak berubah setelah
   * upload, jadi ringkasan sepasang run tidak pernah basi; run yang dihapus tidak lagi lolos `resolvePair` sehingga
   * entrinya tidak terjangkau. Hanya angka dan ringkasan run yang disimpan, tidak pernah badge bug (status bug berubah).
   * Otorisasi dan pemilihan pasangan run tetap berjalan setiap permintaan; yang dilewati hanya membaca dan
   * mengelompokkan hasil kedua run.
   */
  const summaryCache = new LruCache<string, CompareDto>(COMPARE_SUMMARY_CACHE_SIZE);
  const summaryKey = (projectId: string, baseId: string, targetId: string) => `${projectId}:${baseId}:${targetId}`;

  app.get<{ Params: { slug: string } }>("/projects/:slug/versions", readAccess, async (req): Promise<VersionDto[]> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const requested = parseOrThrow(versionsQuery, req.query).branch;
    return heavyRead(async (db) => {
      const branch = requested ?? (await latestBranch(db, project.id));
      const branchRuns = branch === null ? [] : await listBranchRuns(db, project.id, branch);
      const rows = mergeVersions(listVersions(branchRuns), await listLatestManualRunsByVersion(db, project.id));
      // Hitungan status hanya untuk run manual yang benar-benar tampil (satu query `GROUP BY`).
      const shownRuns = rows.flatMap((row) => (row.manualRun === null ? [] : [row.manualRun.id]));
      const counts = await countsByRun(db, shownRuns);
      return rows.map(({ automated, version, manualRun }): VersionDto => ({
        ...(automated ?? { version, run: null, runCount: 0, passRate: null, passRateDelta: null }),
        manual: manualRun === null ? null : toManualRef(manualRun, counts.get(manualRun.id) ?? {}),
      }));
    });
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

      const { base, target, groups, pages, bugs, messages, cached } = await heavyRead(async (db) => {
        const pair = await resolvePair(db, project.id, query);
        // Cursor hanya berlaku untuk pasangan run tempat ia dibuat (default bisa bergeser setelah upload baru).
        if (after !== undefined && (pair.base?.id !== after.baseId || pair.target?.id !== after.targetId)) {
          throw staleCursor();
        }
        const hit =
          query.groups === "none" && pair.base !== null && pair.target !== null
            ? summaryCache.get(summaryKey(project.id, pair.base.id, pair.target.id))
            : undefined;
        if (pair.base === null || pair.target === null || hit !== undefined) {
          return {
            ...pair,
            cached: hit,
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
            cached: undefined,
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
          cached: undefined,
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
      if (cached !== undefined) return cached;

      const count = (group: CompareGroup) => groups?.[group].length ?? 0;
      const response: CompareDto = {
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
      // `groups=none` dengan kedua run: semua kelompok kosong, jadi respons itu sendiri bebas badge bug.
      if (query.groups === "none" && base !== null && target !== null) {
        summaryCache.set(summaryKey(project.id, base.id, target.id), response);
      }
      return response;
    },
  );
}
