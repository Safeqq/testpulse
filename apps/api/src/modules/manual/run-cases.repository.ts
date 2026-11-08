import {
  caseStep,
  stepResult,
  type ManualResultStatus,
  type ManualRunStatus,
  type RunCaseDto,
  type RunCaseListItemDto,
  type RunCaseListQuery,
  type UpdateRunCaseBody,
} from "@testpulse/shared";
import { and, asc, eq, gt, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db, Queryable } from "../../db/client.js";
import { manualRunCases, manualRuns, memberships, users } from "../../db/schema.js";
import { isUuid } from "../../http/uuid.js";
import { stepResultsMatch } from "./domain/results.js";

/*
 * Urutan kunci di jalur tulis run case (menghindari deadlock):
 *   baris run (`FOR SHARE`) → membership assignee (`FOR KEY SHARE`, bila assignee diisi) → baris run case (`FOR UPDATE`).
 * - Kunci `FOR SHARE` pada run membuat status run diperiksa di transaksi yang sama dengan penulisan (spec §4.4):
 *   penyelesaian run (`FOR UPDATE` pada baris run) menunggu penulisan yang sedang berjalan, dan penulisan sesudahnya
 *   melihat `completed`. Dua penulisan run case berbeda saling kompatibel (`FOR SHARE` + `FOR SHARE`); jalur ini tidak
 *   pernah meng-UPDATE baris run, karena itu akan saling mengunci dengan penulis lain yang memegang `FOR SHARE`.
 * - Pengeluaran anggota (`clearRunCaseAssigneesOnLeave`) mengunci membership lalu run case, urutan yang sama.
 */

type RunCaseChanges = PgUpdateSetSource<typeof manualRunCases>;

const assigneeUser = alias(users, "assignee");
const executorUser = alias(users, "executor");

/** Isi JSONB divalidasi schema shared saat dibaca (spec §6). */
const stepsSchema = z.array(caseStep);
const stepResultsSchema = z.array(stepResult);

const userRef = (id: string | null, name: string | null) => (id !== null && name !== null ? { id, name } : null);

// ---------------------------------------------------------------------------------------------------------------
// Daftar
// ---------------------------------------------------------------------------------------------------------------

export interface ListRunCasesOptions {
  runId: string;
  /** Pengguna sesi untuk `assignee=me` (anonim → tidak ada yang cocok). */
  userId: string | null;
  query: Omit<RunCaseListQuery, "cursor">;
  /** Posisi run case terakhir halaman sebelumnya. */
  after?: number;
  limit: number;
}

/**
 * Satu halaman run case (spec §7), urut `position`. `suite` = nama suite snapshot. `bugs` diisi Task 6; di sini `[]`.
 */
export async function listRunCases(db: Queryable, opts: ListRunCasesOptions): Promise<RunCaseListItemDto[]> {
  const { query } = opts;
  const conditions: SQL[] = [eq(manualRunCases.runId, opts.runId)];
  if (query.status !== undefined) conditions.push(eq(manualRunCases.status, query.status));
  if (query.assignee === "none") conditions.push(isNull(manualRunCases.assigneeId));
  else if (query.assignee === "me") conditions.push(opts.userId ? eq(manualRunCases.assigneeId, opts.userId) : sql`false`);
  else if (query.assignee !== undefined) conditions.push(eq(manualRunCases.assigneeId, query.assignee));
  if (query.suite !== undefined) conditions.push(eq(manualRunCases.suiteName, query.suite));
  if (opts.after !== undefined) conditions.push(gt(manualRunCases.position, opts.after));

  const rows = await db
    .select({
      id: manualRunCases.id,
      position: manualRunCases.position,
      caseNumber: manualRunCases.caseNumber,
      title: manualRunCases.title,
      suiteName: manualRunCases.suiteName,
      priority: manualRunCases.priority,
      status: manualRunCases.status,
      assigneeId: assigneeUser.id,
      assigneeName: assigneeUser.name,
      executedAt: manualRunCases.executedAt,
    })
    .from(manualRunCases)
    .leftJoin(assigneeUser, eq(assigneeUser.id, manualRunCases.assigneeId))
    .where(and(...conditions))
    .orderBy(asc(manualRunCases.position))
    .limit(opts.limit);

  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    caseNumber: row.caseNumber,
    title: row.title,
    suiteName: row.suiteName,
    priority: row.priority,
    status: row.status as ManualResultStatus,
    assignee: userRef(row.assigneeId, row.assigneeName),
    executedAt: row.executedAt?.toISOString() ?? null,
    bugs: [],
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------------------------

/**
 * Run case `untested` berikutnya (spec §7): posisi terkecil setelah `position`, bila tidak ada berputar ke posisi
 * terkecil dari awal. Run case saat ini tidak pernah dihitung; `null` bila tidak ada yang tersisa.
 */
async function nextUntestedId(db: Queryable, runId: string, current: { id: string; position: number }): Promise<string | null> {
  const [row] = await db
    .select({ id: manualRunCases.id })
    .from(manualRunCases)
    .where(and(eq(manualRunCases.runId, runId), eq(manualRunCases.status, "untested"), ne(manualRunCases.id, current.id)))
    .orderBy(sql`${manualRunCases.position} < ${current.position}`, asc(manualRunCases.position))
    .limit(1);
  return row?.id ?? null;
}

/** Run case lengkap (snapshot + hasil) dari run `runId`, atau `null` bila id itu bukan milik run tersebut. */
export async function loadRunCaseDto(db: Queryable, runId: string, id: string): Promise<RunCaseDto | null> {
  const [row] = await db
    .select({
      id: manualRunCases.id,
      position: manualRunCases.position,
      caseId: manualRunCases.caseId,
      caseNumber: manualRunCases.caseNumber,
      title: manualRunCases.title,
      suiteName: manualRunCases.suiteName,
      priority: manualRunCases.priority,
      preconditions: manualRunCases.preconditions,
      steps: manualRunCases.steps,
      status: manualRunCases.status,
      stepResults: manualRunCases.stepResults,
      note: manualRunCases.note,
      assigneeId: assigneeUser.id,
      assigneeName: assigneeUser.name,
      executedById: executorUser.id,
      executedByName: executorUser.name,
      executedAt: manualRunCases.executedAt,
      version: manualRunCases.version,
      updatedAt: manualRunCases.updatedAt,
      runStatus: manualRuns.status,
    })
    .from(manualRunCases)
    .innerJoin(manualRuns, eq(manualRuns.id, manualRunCases.runId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, manualRunCases.assigneeId))
    .leftJoin(executorUser, eq(executorUser.id, manualRunCases.executedBy))
    .where(and(eq(manualRunCases.id, id), eq(manualRunCases.runId, runId)));
  if (!row) return null;

  return {
    id: row.id,
    position: row.position,
    caseNumber: row.caseNumber,
    title: row.title,
    suiteName: row.suiteName,
    priority: row.priority,
    status: row.status as ManualResultStatus,
    assignee: userRef(row.assigneeId, row.assigneeName),
    executedAt: row.executedAt?.toISOString() ?? null,
    bugs: [],
    preconditions: row.preconditions,
    steps: stepsSchema.parse(row.steps),
    stepResults: stepResultsSchema.parse(row.stepResults),
    note: row.note,
    executedBy: userRef(row.executedById, row.executedByName),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    nextUntestedId: await nextUntestedId(db, runId, row),
    caseId: row.caseId,
    runStatus: row.runStatus as ManualRunStatus,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------------------------

export type UpdateRunCaseFailure =
  | "run_not_found"
  | "not_found"
  | "conflict"
  | "completed"
  | { field: "stepResults" | "assigneeId" };

/** Anggota project (role apa pun)? Dikunci `FOR KEY SHARE` seperti assignee bug (lihat bugs/write.repository.ts). */
async function lockMembership(tx: Queryable, projectId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)))
    .for("key share");
  return row !== undefined;
}

/**
 * Mengubah hasil run case dalam satu transaksi (spec §4.3, §4.4), dengan urutan kunci di atas berkas. Run `completed`
 * → `completed`; `version` basi → `conflict`; `stepResults` harus sepanjang langkah snapshot. `executedBy`/`executedAt`
 * diisi saat status diubah ke selain `untested` dan dikosongkan saat kembali ke `untested`. Field yang nilainya sama
 * diabaikan; `version` dan `updated_at` naik hanya bila ada perubahan.
 */
export async function updateRunCase(
  db: Db,
  input: { projectId: string; runNumber: number; runCaseId: string; actorId: string; body: UpdateRunCaseBody },
): Promise<RunCaseDto | UpdateRunCaseFailure> {
  const { projectId, runNumber, runCaseId, actorId, body } = input;
  return db.transaction(async (tx): Promise<RunCaseDto | UpdateRunCaseFailure> => {
    const [run] = await tx
      .select({ id: manualRuns.id, status: manualRuns.status })
      .from(manualRuns)
      .where(and(eq(manualRuns.projectId, projectId), eq(manualRuns.number, runNumber)))
      .for("share");
    if (!run) return "run_not_found";
    // Id bukan uuid → 404 tanpa query (Postgres menolak bind-nya).
    if (!isUuid(runCaseId)) return "not_found";

    // Id di luar run ini → 404 lebih dulu daripada status run dan validasi assignee (pencarian tanpa kunci).
    const [exists] = await tx
      .select({ id: manualRunCases.id })
      .from(manualRunCases)
      .where(and(eq(manualRunCases.id, runCaseId), eq(manualRunCases.runId, run.id)));
    if (!exists) return "not_found";
    if (run.status === "completed") return "completed";

    if (body.assigneeId && !(await lockMembership(tx, projectId, body.assigneeId))) return { field: "assigneeId" };

    const [row] = await tx
      .select()
      .from(manualRunCases)
      .where(and(eq(manualRunCases.id, runCaseId), eq(manualRunCases.runId, run.id)))
      .for("update");
    if (!row) return "not_found";
    if (row.version !== body.version) return "conflict";

    const changes: RunCaseChanges = {};
    if (body.stepResults !== undefined) {
      if (!stepResultsMatch(body.stepResults, stepsSchema.parse(row.steps).length)) return { field: "stepResults" };
      // Kedua sisi melewati schema yang sama, jadi urutan kunci objek sama (JSONB menyimpan kunci dengan urutan lain).
      if (JSON.stringify(body.stepResults) !== JSON.stringify(stepResultsSchema.parse(row.stepResults))) {
        changes.stepResults = body.stepResults;
      }
    }
    if (body.status !== undefined && body.status !== row.status) {
      changes.status = body.status;
      changes.executedBy = body.status === "untested" ? null : actorId;
      changes.executedAt = body.status === "untested" ? null : sql`statement_timestamp()`;
    }
    if (body.note !== undefined && body.note !== row.note) changes.note = body.note;
    if (body.assigneeId !== undefined && body.assigneeId !== row.assigneeId) changes.assigneeId = body.assigneeId;

    if (Object.keys(changes).length > 0) {
      // `statement_timestamp()` (bukan `now()` = awal transaksi): waktu penulisan yang sebenarnya, sehingga invarian
      // "tidak ada run case dengan `updated_at` > `completed_at`" benar-benar membuktikan urutan kunci di atas.
      await tx
        .update(manualRunCases)
        .set({ ...changes, version: sql`${manualRunCases.version} + 1`, updatedAt: sql`statement_timestamp()` })
        .where(eq(manualRunCases.id, row.id));
    }
    const dto = await loadRunCaseDto(tx, run.id, row.id);
    if (!dto) throw new Error("run case hilang di tengah transaksi");
    return dto;
  });
}

/**
 * Dipanggil di dalam transaksi penghapusan membership (spec §4.3, §6): mengosongkan assignee semua run case di run
 * project itu yang di-assign ke `userId`, termasuk run yang sudah selesai. `version` naik agar editor dengan versi lama
 * mendapat 409 dan memuat ulang; `updated_at` tidak disentuh karena menandai perubahan hasil eksekusi (tidak ada hasil
 * yang berubah, dan run selesai tetap tidak punya run case dengan `updated_at` > `completed_at`).
 */
export async function clearRunCaseAssigneesOnLeave(tx: Queryable, projectId: string, userId: string): Promise<void> {
  const projectRuns = tx.select({ id: manualRuns.id }).from(manualRuns).where(eq(manualRuns.projectId, projectId));
  await tx
    .update(manualRunCases)
    .set({ assigneeId: null, version: sql`${manualRunCases.version} + 1` })
    .where(and(eq(manualRunCases.assigneeId, userId), inArray(manualRunCases.runId, projectRuns)));
}
