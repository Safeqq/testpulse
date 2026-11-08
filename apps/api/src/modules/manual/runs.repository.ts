import {
  caseStep,
  type CreateManualRunBody,
  type ManualCountsDto,
  type ManualRunDto,
  type ManualRunListQuery,
  type ManualRunStatus,
  type ManualRunSummaryDto,
  type UpdateManualRunBody,
} from "@testpulse/shared";
import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db, Queryable } from "../../db/client.js";
import { caseSuites, manualCases, manualRunCases, manualRuns, projects, users } from "../../db/schema.js";
import { emptyStepResults } from "./domain/results.js";
import { selectRunCases } from "./domain/selection.js";
import { buildSnapshot } from "./domain/snapshot.js";
import { summarize } from "./domain/summary.js";

/*
 * Urutan kunci di jalur tulis run manual (lihat juga run-cases.repository.ts):
 * - Buat run: project (`FOR NO KEY UPDATE`) → case project (`FOR KEY SHARE`). Kunci project menyerialkan penomoran
 *   `manual_run_seq` dan menahan pembuatan/penghapusan suite & case baru; kunci case menahan penghapusan case sampai
 *   run case yang merujuknya tertulis.
 * - Ubah run (termasuk menyelesaikan/membuka ulang): baris run (`FOR UPDATE`) saja. Penulisan run case memegang
 *   baris run `FOR SHARE` sampai commit, jadi penyelesaian run menunggu semua penulisan run case yang sedang berjalan
 *   dan penulisan run case berikutnya melihat status `completed` (spec §4.4).
 */

type RunChanges = PgUpdateSetSource<typeof manualRuns>;

const creatorUser = alias(users, "creator");
const completerUser = alias(users, "completer");

/** Isi JSONB divalidasi schema shared saat dibaca (spec §6). */
const stepsSchema = z.array(caseStep);

export const runByNumber = (projectId: string, number: number) =>
  and(eq(manualRuns.projectId, projectId), eq(manualRuns.number, number));

// ---------------------------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------------------------

/** Hitungan status run case per run, dihitung dengan `GROUP BY` saat dibaca (spec §4.5), satu query untuk semua run. */
export async function countsByRun(db: Queryable, runIds: string[]): Promise<Map<string, Partial<ManualCountsDto>>> {
  const grouped = new Map<string, Partial<ManualCountsDto>>(runIds.map((id) => [id, {}]));
  if (runIds.length === 0) return grouped;
  const rows = await db
    .select({
      runId: manualRunCases.runId,
      status: manualRunCases.status,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(manualRunCases)
    .where(inArray(manualRunCases.runId, runIds))
    .groupBy(manualRunCases.runId, manualRunCases.status);
  for (const row of rows) {
    const counts = grouped.get(row.runId);
    if (counts) counts[row.status as keyof ManualCountsDto] = row.count;
  }
  return grouped;
}

const runColumns = {
  id: manualRuns.id,
  number: manualRuns.number,
  name: manualRuns.name,
  appVersion: manualRuns.appVersion,
  status: manualRuns.status,
  createdById: manualRuns.createdBy,
  createdByName: creatorUser.name,
  completedById: completerUser.id,
  completedByName: completerUser.name,
  createdAt: manualRuns.createdAt,
  updatedAt: manualRuns.updatedAt,
  completedAt: manualRuns.completedAt,
  version: manualRuns.version,
};

/** Run beserta ringkasannya. Urutan: nomor TR terbesar dulu (lihat `listManualRuns`). */
async function selectRuns(db: Queryable, where: SQL | undefined, limit?: number): Promise<ManualRunDto[]> {
  const base = db
    .select(runColumns)
    .from(manualRuns)
    .innerJoin(creatorUser, eq(creatorUser.id, manualRuns.createdBy))
    .leftJoin(completerUser, eq(completerUser.id, manualRuns.completedBy))
    .where(where)
    .orderBy(desc(manualRuns.number));
  const rows = limit === undefined ? await base : await base.limit(limit);

  const counts = await countsByRun(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    number: row.number,
    name: row.name,
    appVersion: row.appVersion,
    status: row.status as ManualRunStatus,
    ...summarize(counts.get(row.id) ?? {}),
    createdBy: { id: row.createdById, name: row.createdByName },
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy:
      row.completedById !== null && row.completedByName !== null ? { id: row.completedById, name: row.completedByName } : null,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  }));
}

/** Item daftar: ringkasan tanpa field detail (`completedBy`, `updatedAt`, `version`). */
function toSummary(run: ManualRunDto): ManualRunSummaryDto {
  return {
    number: run.number,
    name: run.name,
    appVersion: run.appVersion,
    status: run.status,
    total: run.total,
    counts: run.counts,
    progress: run.progress,
    createdBy: run.createdBy,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

async function loadRunDto(db: Queryable, runId: string): Promise<ManualRunDto> {
  const [run] = await selectRuns(db, eq(manualRuns.id, runId));
  if (!run) throw new Error("run hilang di tengah transaksi");
  return run;
}

/** Detail run berdasarkan nomor `TR-<n>`. */
export async function findManualRun(db: Queryable, projectId: string, number: number): Promise<ManualRunDto | null> {
  const [run] = await selectRuns(db, runByNumber(projectId, number));
  return run ?? null;
}

/** Id & status run berdasarkan nomor (tanpa kunci), untuk rute run case. */
export async function findRunRef(
  db: Queryable,
  projectId: string,
  number: number,
): Promise<{ id: string; status: ManualRunStatus } | null> {
  const [row] = await db
    .select({ id: manualRuns.id, status: manualRuns.status })
    .from(manualRuns)
    .where(runByNumber(projectId, number));
  return row ? { id: row.id, status: row.status as ManualRunStatus } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Daftar
// ---------------------------------------------------------------------------------------------------------------

export interface ListManualRunsOptions {
  projectId: string;
  query: Omit<ManualRunListQuery, "cursor">;
  /** Nomor run terakhir halaman sebelumnya. */
  after?: number;
  limit: number;
}

/**
 * Satu halaman daftar run (spec §7), terbaru dulu. "Terbaru" = nomor TR terbesar: nomor dibagikan berurutan di bawah
 * kunci project, sedangkan `created_at` (waktu awal transaksi) bisa terbalik antar pembuatan paralel. Nomor unik per
 * project, jadi juga menjadi kunci keyset cursor.
 */
export async function listManualRuns(db: Queryable, opts: ListManualRunsOptions): Promise<ManualRunSummaryDto[]> {
  const conditions: SQL[] = [eq(manualRuns.projectId, opts.projectId)];
  if (opts.query.status !== "all") conditions.push(eq(manualRuns.status, opts.query.status));
  if (opts.query.appVersion !== undefined) conditions.push(eq(manualRuns.appVersion, opts.query.appVersion));
  if (opts.after !== undefined) conditions.push(lt(manualRuns.number, opts.after));
  return (await selectRuns(db, and(...conditions), opts.limit)).map(toSummary);
}

// ---------------------------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------------------------

export type CreateManualRunFailure = "project_not_found" | { field: "suiteIds" | "caseNumbers" | "selection" };

/**
 * Membuat run dalam satu transaksi (spec §4.2): kunci project, seleksi case (domain `selectRunCases` menerima semua
 * suite dan semua case project, termasuk arsip, agar error dilaporkan pada field yang tepat), nomor dari
 * `projects.manual_run_seq`, lalu semua run case (snapshot) ditulis dengan satu `INSERT` multi-baris. Kegagalan
 * seleksi dikembalikan sebelum `manual_run_seq` dinaikkan.
 */
export async function createManualRun(
  db: Db,
  input: { projectId: string; actorId: string; body: CreateManualRunBody },
): Promise<ManualRunDto | CreateManualRunFailure> {
  const { projectId, actorId, body } = input;
  return db.transaction(async (tx): Promise<ManualRunDto | CreateManualRunFailure> => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("no key update");
    if (!project) return "project_not_found";

    const suites = await tx
      .select({ id: caseSuites.id, name: caseSuites.name, position: caseSuites.position })
      .from(caseSuites)
      .where(eq(caseSuites.projectId, projectId));
    const cases = await tx
      .select({
        id: manualCases.id,
        number: manualCases.number,
        suiteId: manualCases.suiteId,
        title: manualCases.title,
        preconditions: manualCases.preconditions,
        steps: manualCases.steps,
        priority: manualCases.priority,
        archivedAt: manualCases.archivedAt,
      })
      .from(manualCases)
      .where(eq(manualCases.projectId, projectId))
      .for("key share");

    const selection = selectRunCases({
      suites,
      cases: cases.map((c) => ({ id: c.id, number: c.number, suiteId: c.suiteId, archived: c.archivedAt !== null })),
      suiteIds: body.suiteIds,
      caseNumbers: body.caseNumbers,
    });
    if (!selection.ok) return { field: selection.field };

    const caseById = new Map(cases.map((c) => [c.id, c]));
    const suiteById = new Map(suites.map((s) => [s.id, s]));
    const snapshots = selection.caseIds.map((id, position) => {
      const c = caseById.get(id)!;
      return buildSnapshot({ ...c, steps: stepsSchema.parse(c.steps) }, suiteById.get(c.suiteId)!, position);
    });

    const [seq] = await tx
      .update(projects)
      .set({ manualRunSeq: sql`${projects.manualRunSeq} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ manualRunSeq: projects.manualRunSeq });
    if (!seq) return "project_not_found";

    const [run] = await tx
      .insert(manualRuns)
      .values({
        projectId,
        number: seq.manualRunSeq,
        name: body.name,
        appVersion: body.appVersion ?? null,
        createdBy: actorId,
      })
      .returning({ id: manualRuns.id });
    if (!run) throw new Error("insert run tidak mengembalikan baris");

    await tx
      .insert(manualRunCases)
      .values(snapshots.map((snapshot) => ({ ...snapshot, runId: run.id, stepResults: emptyStepResults(snapshot.steps.length) })));
    return loadRunDto(tx, run.id);
  });
}

export type UpdateManualRunFailure = "not_found" | "conflict" | "completed";

/**
 * Mengubah run (spec §4.4, §7): kunci baris run (`FOR UPDATE`). Selama `completed` hanya `{ status: "open" }` yang
 * diterima (selain itu `completed`), lalu `version` dicek. Field yang nilainya sama diabaikan; `version` dan
 * `updated_at` naik hanya bila ada perubahan.
 *
 * Waktu memakai `statement_timestamp()`, bukan `now()`: statement ini berjalan setelah kunci run diperoleh, yaitu
 * setelah semua penulisan run case yang memegang kunci `FOR SHARE` selesai, sehingga `completed_at` tidak pernah lebih
 * awal daripada `updated_at` run case mana pun (`now()` = awal transaksi bisa mendahului penulisan itu).
 */
export async function updateManualRun(
  db: Db,
  input: { projectId: string; number: number; actorId: string; body: UpdateManualRunBody },
): Promise<ManualRunDto | UpdateManualRunFailure> {
  const { projectId, number, actorId, body } = input;
  return db.transaction(async (tx): Promise<ManualRunDto | UpdateManualRunFailure> => {
    const [run] = await tx.select().from(manualRuns).where(runByNumber(projectId, number)).for("update");
    if (!run) return "not_found";
    if (run.status === "completed") {
      const reopenOnly = body.status === "open" && body.name === undefined && body.appVersion === undefined;
      if (!reopenOnly) return "completed";
    }
    if (run.version !== body.version) return "conflict";

    const changes: RunChanges = {};
    if (body.name !== undefined && body.name !== run.name) changes.name = body.name;
    if (body.appVersion !== undefined && body.appVersion !== run.appVersion) changes.appVersion = body.appVersion;
    if (body.status !== undefined && body.status !== run.status) {
      changes.status = body.status;
      if (body.status === "completed") {
        changes.completedBy = actorId;
        changes.completedAt = sql`statement_timestamp()`;
      } else {
        changes.completedBy = null;
        changes.completedAt = null;
      }
    }
    if (Object.keys(changes).length === 0) return loadRunDto(tx, run.id);

    await tx
      .update(manualRuns)
      .set({ ...changes, version: sql`${manualRuns.version} + 1`, updatedAt: sql`statement_timestamp()` })
      .where(eq(manualRuns.id, run.id));
    return loadRunDto(tx, run.id);
  });
}

/** Menghapus run beserta run case-nya (FK cascade); `bugs.manual_run_case_id` menjadi `null`. False bila tidak ada. */
export async function deleteManualRun(db: Db, projectId: string, number: number): Promise<boolean> {
  const deleted = await db.delete(manualRuns).where(runByNumber(projectId, number)).returning({ id: manualRuns.id });
  return deleted.length > 0;
}
