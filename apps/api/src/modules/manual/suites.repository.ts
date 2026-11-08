import { MAX_SUITES, type SuiteBody, type SuiteDto, type UpdateSuiteBody } from "@testpulse/shared";
import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { caseSuites, manualCases, projects } from "../../db/schema.js";
import { moveItem } from "./domain/order.js";

/*
 * Urutan kunci di jalur tulis suite dan case: project (`FOR NO KEY UPDATE`) → baris suite. Pembuatan, perubahan, dan
 * penghapusan suite semuanya mengunci baris project lebih dulu, sehingga penomoran posisi dan batas 200 suite tidak
 * bisa saling menimpa; pembuatan case ikut mengunci project, jadi tidak menyelip saat suite dihapus.
 */

const suiteCounts = {
  activeCount: sql<number>`count(${manualCases.id}) filter (where ${manualCases.archivedAt} is null)`.mapWith(Number),
  archivedCount: sql<number>`count(${manualCases.id}) filter (where ${manualCases.archivedAt} is not null)`.mapWith(Number),
};

async function selectSuites(db: Queryable, where: SQL | undefined): Promise<SuiteDto[]> {
  return db
    .select({
      id: caseSuites.id,
      name: caseSuites.name,
      description: caseSuites.description,
      position: caseSuites.position,
      ...suiteCounts,
    })
    .from(caseSuites)
    .leftJoin(manualCases, eq(manualCases.suiteId, caseSuites.id))
    .where(where)
    .groupBy(caseSuites.id)
    .orderBy(asc(caseSuites.position), asc(caseSuites.id));
}

/** Semua suite project urut `position`, masing-masing dengan jumlah case aktif dan arsip. */
export function listSuites(db: Queryable, projectId: string): Promise<SuiteDto[]> {
  return selectSuites(db, eq(caseSuites.projectId, projectId));
}

async function loadSuite(db: Queryable, id: string): Promise<SuiteDto> {
  const [suite] = await selectSuites(db, eq(caseSuites.id, id));
  if (!suite) throw new Error("suite hilang di tengah transaksi");
  return suite;
}

/** Kunci baris project; false bila project sudah terhapus setelah rute memeriksa akses. */
async function lockProject(tx: Queryable, projectId: string): Promise<boolean> {
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("no key update");
  return project !== undefined;
}

/** Nama dipakai suite lain di project ini (tanpa membedakan huruf besar/kecil)? `exceptId` = suite yang sedang diubah. */
async function nameTaken(tx: Queryable, projectId: string, name: string, exceptId?: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: caseSuites.id })
    .from(caseSuites)
    .where(
      and(
        eq(caseSuites.projectId, projectId),
        sql`lower(${caseSuites.name}) = lower(${name})`,
        exceptId === undefined ? undefined : ne(caseSuites.id, exceptId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Pelanggaran unique index (SQLSTATE 23505), langsung atau dibungkus drizzle sebagai `cause`. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 3; depth += 1) {
    if (typeof current !== "object") return false;
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export type CreateSuiteFailure = "project_not_found" | "limit_reached" | "name_taken";

/**
 * Membuat suite di posisi terakhir (spec §3.1). Project dikunci lebih dulu sehingga pembuatan paralel melihat jumlah
 * dan posisi yang konsisten; nama dicek lebih dulu agar pesan andal, dan 23505 dari unique index (jaring pengaman)
 * dipetakan ke hasil yang sama.
 */
export async function createSuite(
  db: Db,
  input: { projectId: string; body: SuiteBody },
): Promise<SuiteDto | CreateSuiteFailure> {
  const { projectId, body } = input;
  try {
    return await db.transaction(async (tx): Promise<SuiteDto | CreateSuiteFailure> => {
      if (!(await lockProject(tx, projectId))) return "project_not_found";

      const [stats] = await tx
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
          last: sql<number>`coalesce(max(${caseSuites.position}), -1)`.mapWith(Number),
        })
        .from(caseSuites)
        .where(eq(caseSuites.projectId, projectId));
      if (!stats || stats.count >= MAX_SUITES) return "limit_reached";
      if (await nameTaken(tx, projectId, body.name)) return "name_taken";

      const [created] = await tx
        .insert(caseSuites)
        .values({ projectId, name: body.name, description: body.description ?? "", position: stats.last + 1 })
        .returning({ id: caseSuites.id });
      if (!created) throw new Error("insert suite tidak mengembalikan baris");
      return loadSuite(tx, created.id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "name_taken";
    throw error;
  }
}

export type UpdateSuiteFailure = "not_found" | "name_taken";

/** Menyimpan posisi baru semua suite yang indeksnya berubah (menomori ulang 0..n-1 tanpa celah). */
async function renumber(tx: Queryable, ordered: readonly { id: string; position: number }[]): Promise<void> {
  for (const [index, suite] of ordered.entries()) {
    if (suite.position !== index) {
      await tx.update(caseSuites).set({ position: index, updatedAt: sql`now()` }).where(eq(caseSuites.id, suite.id));
    }
  }
}

/**
 * Mengubah nama/deskripsi dan/atau posisi suite (spec §3.1). Semua suite project dikunci (`FOR UPDATE`) dalam satu
 * transaksi, lalu `moveItem` menghitung urutan baru dan semua suite dinomori ulang 0..n-1; `position` di luar rentang
 * dibatasi ke rentang yang ada.
 */
export async function updateSuite(
  db: Db,
  input: { projectId: string; id: string; body: UpdateSuiteBody },
): Promise<SuiteDto | UpdateSuiteFailure> {
  const { projectId, id, body } = input;
  try {
    return await db.transaction(async (tx): Promise<SuiteDto | UpdateSuiteFailure> => {
      if (!(await lockProject(tx, projectId))) return "not_found";
      const suites = await tx
        .select({ id: caseSuites.id, position: caseSuites.position })
        .from(caseSuites)
        .where(eq(caseSuites.projectId, projectId))
        .orderBy(asc(caseSuites.position), asc(caseSuites.id))
        .for("update");
      const from = suites.findIndex((suite) => suite.id === id);
      if (from === -1) return "not_found";

      if (body.name !== undefined && (await nameTaken(tx, projectId, body.name, id))) return "name_taken";

      const changes: Partial<Pick<typeof caseSuites.$inferInsert, "name" | "description">> = {};
      if (body.name !== undefined) changes.name = body.name;
      if (body.description !== undefined) changes.description = body.description;
      if (Object.keys(changes).length > 0) {
        await tx.update(caseSuites).set({ ...changes, updatedAt: sql`now()` }).where(eq(caseSuites.id, id));
      }
      if (body.position !== undefined) await renumber(tx, moveItem(suites, from, body.position));
      return loadSuite(tx, id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "name_taken";
    throw error;
  }
}

export type DeleteSuiteResult = "deleted" | "not_found" | "not_empty";

/** Menghapus suite hanya bila tanpa case sama sekali (termasuk arsip); sisanya dinomori ulang tanpa celah. */
export async function deleteSuite(db: Db, input: { projectId: string; id: string }): Promise<DeleteSuiteResult> {
  const { projectId, id } = input;
  return db.transaction(async (tx): Promise<DeleteSuiteResult> => {
    if (!(await lockProject(tx, projectId))) return "not_found";
    const [suite] = await tx
      .select({ id: caseSuites.id })
      .from(caseSuites)
      .where(and(eq(caseSuites.id, id), eq(caseSuites.projectId, projectId)))
      .for("update");
    if (!suite) return "not_found";

    const [used] = await tx.select({ id: manualCases.id }).from(manualCases).where(eq(manualCases.suiteId, id)).limit(1);
    if (used) return "not_empty";

    await tx.delete(caseSuites).where(eq(caseSuites.id, id));
    const rest = await tx
      .select({ id: caseSuites.id, position: caseSuites.position })
      .from(caseSuites)
      .where(eq(caseSuites.projectId, projectId))
      .orderBy(asc(caseSuites.position), asc(caseSuites.id));
    await renumber(tx, rest);
    return "deleted";
  });
}
