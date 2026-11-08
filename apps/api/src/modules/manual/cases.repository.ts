import {
  caseStep,
  type CaseCoverageDto,
  type CaseListQuery,
  type CasePriority,
  type CreateCaseBody,
  type ManualCaseDto,
  type ManualCaseListItemDto,
  type TestSearchItemDto,
  type UpdateCaseBody,
} from "@testpulse/shared";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db, Queryable } from "../../db/client.js";
import { caseSuites, manualCaseLabels, manualCases, projects, testCases, users } from "../../db/schema.js";
import { escapeLike, sortLabels } from "../bugs/read.repository.js";
import type { CaseCursor } from "./cursor.js";

/*
 * Urutan kunci baris di jalur tulis case: project → suite/test tujuan → case. Pembuatan case mengunci project
 * (`FOR NO KEY UPDATE`) seperti suite, jadi penomoran `case_seq` berurutan dan tidak menyelip saat suite dihapus.
 */

type CaseChanges = PgUpdateSetSource<typeof manualCases>;

const creatorUser = alias(users, "creator");
const updaterUser = alias(users, "updater");

/** Isi JSONB divalidasi schema shared saat dibaca (spec §6). */
const stepsSchema = z.array(caseStep);

export const caseByNumber = (projectId: string, number: number) =>
  and(eq(manualCases.projectId, projectId), eq(manualCases.number, number));

// ---------------------------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------------------------

/** Label per case (urutan `sortLabels`) dengan satu query. */
async function labelsByCase(db: Queryable, caseIds: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>(caseIds.map((id) => [id, []]));
  if (caseIds.length === 0) return grouped;
  const rows = await db
    .select({ caseId: manualCaseLabels.caseId, label: manualCaseLabels.label })
    .from(manualCaseLabels)
    .where(inArray(manualCaseLabels.caseId, caseIds));
  for (const row of rows) grouped.get(row.caseId)?.push(row.label);
  return new Map([...grouped].map(([id, labels]) => [id, sortLabels(labels)]));
}

/**
 * Detail case. `automatedTest.lastResult` dan `recentResults` diisi Task 6 (spec §5.3, §7); di sini `null` dan `[]`.
 */
async function loadCaseDto(db: Queryable, caseId: string): Promise<ManualCaseDto> {
  const [row] = await db
    .select({
      id: manualCases.id,
      number: manualCases.number,
      suiteId: caseSuites.id,
      suiteName: caseSuites.name,
      title: manualCases.title,
      preconditions: manualCases.preconditions,
      steps: manualCases.steps,
      priority: manualCases.priority,
      archivedAt: manualCases.archivedAt,
      createdById: manualCases.createdBy,
      createdByName: creatorUser.name,
      updatedById: manualCases.updatedBy,
      updatedByName: updaterUser.name,
      createdAt: manualCases.createdAt,
      updatedAt: manualCases.updatedAt,
      version: manualCases.version,
      testId: testCases.id,
      testSuite: testCases.suite,
      testName: testCases.name,
    })
    .from(manualCases)
    .innerJoin(caseSuites, eq(caseSuites.id, manualCases.suiteId))
    .innerJoin(creatorUser, eq(creatorUser.id, manualCases.createdBy))
    .innerJoin(updaterUser, eq(updaterUser.id, manualCases.updatedBy))
    .leftJoin(testCases, eq(testCases.id, manualCases.automatedTestId))
    .where(eq(manualCases.id, caseId));
  if (!row) throw new Error("case hilang di tengah transaksi");

  const labels = (await labelsByCase(db, [row.id])).get(row.id) ?? [];
  return {
    number: row.number,
    suite: { id: row.suiteId, name: row.suiteName },
    title: row.title,
    preconditions: row.preconditions,
    steps: stepsSchema.parse(row.steps),
    priority: row.priority,
    labels,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdBy: { id: row.createdById, name: row.createdByName },
    updatedBy: { id: row.updatedById, name: row.updatedByName },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    automatedTest:
      row.testId !== null && row.testSuite !== null && row.testName !== null
        ? { id: row.testId, suite: row.testSuite, name: row.testName, lastResult: null }
        : null,
    recentResults: [],
  };
}

/** Case berdasarkan nomor `TC-<n>` (dipakai juga oleh modul run manual). */
export async function findCaseByNumber(db: Queryable, projectId: string, number: number): Promise<ManualCaseDto | null> {
  const [row] = await db.select({ id: manualCases.id }).from(manualCases).where(caseByNumber(projectId, number));
  return row ? loadCaseDto(db, row.id) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------------------------

async function insertLabels(tx: Queryable, caseId: string, labels: readonly string[]): Promise<void> {
  if (labels.length > 0) await tx.insert(manualCaseLabels).values(labels.map((label) => ({ caseId, label })));
}

/** Suite milik project ini? Dikunci `FOR KEY SHARE` agar tidak terhapus sebelum transaksi selesai. */
async function lockSuite(tx: Queryable, projectId: string, suiteId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: caseSuites.id })
    .from(caseSuites)
    .where(and(eq(caseSuites.id, suiteId), eq(caseSuites.projectId, projectId)))
    .for("key share");
  return row !== undefined;
}

/** Automated test (hasil Tahap 2) milik project ini? Dikunci `FOR KEY SHARE`. */
async function lockTest(tx: Queryable, projectId: string, testId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: testCases.id })
    .from(testCases)
    .where(and(eq(testCases.id, testId), eq(testCases.projectId, projectId)))
    .for("key share");
  return row !== undefined;
}

export type CreateCaseFailure = "project_not_found" | "suite_not_found" | "test_not_found";

/**
 * Membuat case dalam satu transaksi. Project dikunci lebih dulu; nomor diambil dari `projects.case_seq`
 * (`UPDATE … RETURNING`), jadi pembuatan paralel tetap unik dan berurutan dan nomor tidak pernah dipakai ulang.
 * Label disimpan dalam transaksi yang sama. Kegagalan validasi dikembalikan sebelum `case_seq` dinaikkan.
 */
export async function createCase(
  db: Db,
  input: { projectId: string; actorId: string; body: CreateCaseBody },
): Promise<ManualCaseDto | CreateCaseFailure> {
  const { projectId, actorId, body } = input;
  return db.transaction(async (tx): Promise<ManualCaseDto | CreateCaseFailure> => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("no key update");
    if (!project) return "project_not_found";

    if (!(await lockSuite(tx, projectId, body.suiteId))) return "suite_not_found";
    if (body.automatedTestId && !(await lockTest(tx, projectId, body.automatedTestId))) return "test_not_found";

    const [seq] = await tx
      .update(projects)
      .set({ caseSeq: sql`${projects.caseSeq} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ caseSeq: projects.caseSeq });
    if (!seq) return "project_not_found";

    const [created] = await tx
      .insert(manualCases)
      .values({
        projectId,
        number: seq.caseSeq,
        suiteId: body.suiteId,
        title: body.title,
        preconditions: body.preconditions ?? "",
        steps: body.steps,
        priority: body.priority ?? "medium",
        automatedTestId: body.automatedTestId ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: manualCases.id });
    if (!created) throw new Error("insert case tidak mengembalikan baris");

    await insertLabels(tx, created.id, body.labels ?? []);
    return loadCaseDto(tx, created.id);
  });
}

export type UpdateCaseFailure = "not_found" | "conflict" | "suite_not_found" | "test_not_found";

/**
 * Mengubah case dalam satu transaksi (spec §3.2, §7): kunci baris case (`FOR UPDATE`), cek `version`, abaikan field
 * yang nilainya sama, naikkan `version` dan `updated_at` hanya bila ada perubahan. `steps`/`labels` mengganti seluruh
 * daftar. Kegagalan apa pun membatalkan seluruh transaksi.
 */
export async function updateCase(
  db: Db,
  input: { projectId: string; number: number; actorId: string; body: UpdateCaseBody },
): Promise<ManualCaseDto | UpdateCaseFailure> {
  const { projectId, number, actorId, body } = input;

  return db.transaction(async (tx): Promise<ManualCaseDto | UpdateCaseFailure> => {
    // Nomor tak dikenal → 404 lebih dulu daripada validasi suite/test (pencarian tanpa kunci).
    const [exists] = await tx.select({ id: manualCases.id }).from(manualCases).where(caseByNumber(projectId, number));
    if (!exists) return "not_found";

    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("key share");
    if (!project) return "not_found";
    if (body.suiteId !== undefined && !(await lockSuite(tx, projectId, body.suiteId))) return "suite_not_found";
    if (body.automatedTestId && !(await lockTest(tx, projectId, body.automatedTestId))) return "test_not_found";

    const [row] = await tx.select().from(manualCases).where(caseByNumber(projectId, number)).for("update");
    if (!row) return "not_found";
    if (row.version !== body.version) return "conflict";

    const changes: CaseChanges = {};
    if (body.suiteId !== undefined && body.suiteId !== row.suiteId) changes.suiteId = body.suiteId;
    if (body.title !== undefined && body.title !== row.title) changes.title = body.title;
    if (body.preconditions !== undefined && body.preconditions !== row.preconditions) {
      changes.preconditions = body.preconditions;
    }
    if (body.steps !== undefined && JSON.stringify(body.steps) !== JSON.stringify(stepsSchema.parse(row.steps))) {
      changes.steps = body.steps;
    }
    if (body.priority !== undefined && body.priority !== row.priority) changes.priority = body.priority as CasePriority;
    if (body.automatedTestId !== undefined && body.automatedTestId !== row.automatedTestId) {
      changes.automatedTestId = body.automatedTestId;
    }
    // Tanggal memakai waktu transaksi database (sama dengan `updated_at`).
    if (body.archived === true && row.archivedAt === null) changes.archivedAt = sql`now()`;
    if (body.archived === false && row.archivedAt !== null) changes.archivedAt = null;

    let newLabels: string[] | undefined;
    if (body.labels !== undefined) {
      const current = (await labelsByCase(tx, [row.id])).get(row.id) ?? [];
      const next = sortLabels(body.labels);
      if (JSON.stringify(next) !== JSON.stringify(current)) newLabels = next;
    }

    if (Object.keys(changes).length === 0 && newLabels === undefined) return loadCaseDto(tx, row.id);

    await tx
      .update(manualCases)
      .set({ ...changes, updatedBy: actorId, version: sql`${manualCases.version} + 1`, updatedAt: sql`now()` })
      .where(eq(manualCases.id, row.id));
    if (newLabels !== undefined) {
      await tx.delete(manualCaseLabels).where(eq(manualCaseLabels.caseId, row.id));
      await insertLabels(tx, row.id, newLabels);
    }
    return loadCaseDto(tx, row.id);
  });
}

/**
 * Menghapus case permanen: label ikut terhapus (FK cascade) dan `manual_run_cases.case_id` menjadi `null`
 * (FK set null), sehingga run lama tetap utuh. False bila nomor tidak ada di project ini.
 */
export async function deleteCase(db: Db, projectId: string, number: number): Promise<boolean> {
  const deleted = await db.delete(manualCases).where(caseByNumber(projectId, number)).returning({ id: manualCases.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Daftar
// ---------------------------------------------------------------------------------------------------------------

export interface ListCasesOptions {
  projectId: string;
  query: Omit<CaseListQuery, "cursor">;
  after?: CaseCursor;
  limit: number;
}

/**
 * Satu halaman daftar case (spec §7), urut posisi suite lalu nomor, dengan posisi keyset tiap case untuk cursor.
 * `archived=false` = hanya case aktif, `archived=true` = hanya case arsip.
 */
export async function listCases(
  db: Queryable,
  opts: ListCasesOptions,
): Promise<{ item: ManualCaseListItemDto; position: CaseCursor }[]> {
  const { query } = opts;
  const conditions: SQL[] = [eq(manualCases.projectId, opts.projectId)];

  if (query.suite !== undefined) conditions.push(eq(manualCases.suiteId, query.suite));
  if (query.priority !== undefined) conditions.push(eq(manualCases.priority, query.priority));
  if (query.label !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${manualCaseLabels} where ${manualCaseLabels.caseId} = ${manualCases.id} and ${manualCaseLabels.label} = ${query.label})`,
    );
  }
  if (query.automated === "yes") conditions.push(sql`${manualCases.automatedTestId} is not null`);
  if (query.automated === "no") conditions.push(sql`${manualCases.automatedTestId} is null`);
  conditions.push(query.archived === "true" ? sql`${manualCases.archivedAt} is not null` : sql`${manualCases.archivedAt} is null`);
  if (query.q !== undefined) conditions.push(sql`${manualCases.title} ilike ${`%${escapeLike(query.q)}%`} escape '\\'`);
  if (opts.after) {
    conditions.push(
      sql`(${caseSuites.position}, ${manualCases.number}) > (${opts.after.suitePosition}::int, ${opts.after.number}::int)`,
    );
  }

  const rows = await db
    .select({
      id: manualCases.id,
      number: manualCases.number,
      title: manualCases.title,
      suiteId: caseSuites.id,
      suiteName: caseSuites.name,
      suitePosition: caseSuites.position,
      priority: manualCases.priority,
      stepCount: sql<number>`jsonb_array_length(${manualCases.steps})`.mapWith(Number),
      automated: sql<boolean>`${manualCases.automatedTestId} is not null`,
      archived: sql<boolean>`${manualCases.archivedAt} is not null`,
      updatedAt: manualCases.updatedAt,
    })
    .from(manualCases)
    .innerJoin(caseSuites, eq(caseSuites.id, manualCases.suiteId))
    .where(and(...conditions))
    .orderBy(asc(caseSuites.position), asc(manualCases.number))
    .limit(opts.limit);

  const labels = await labelsByCase(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    item: {
      number: row.number,
      title: row.title,
      suite: { id: row.suiteId, name: row.suiteName },
      priority: row.priority,
      labels: labels.get(row.id) ?? [],
      stepCount: row.stepCount,
      automated: row.automated,
      archived: row.archived,
      updatedAt: row.updatedAt.toISOString(),
    },
    position: { suitePosition: row.suitePosition, number: row.number },
  }));
}

/** Cakupan otomasi seluruh project (bukan hasil filter): case aktif dan yang tertaut ke automated test. */
export async function caseCoverage(db: Queryable, projectId: string): Promise<CaseCoverageDto> {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${manualCases.archivedAt} is null)`.mapWith(Number),
      automated: sql<number>`count(*) filter (where ${manualCases.archivedAt} is null and ${manualCases.automatedTestId} is not null)`.mapWith(
        Number,
      ),
    })
    .from(manualCases)
    .where(eq(manualCases.projectId, projectId));
  return { active: row?.active ?? 0, automated: row?.automated ?? 0 };
}

/**
 * Label yang dipakai case project ini, unik dan urut abjad. `COLLATE "C"` (urutan byte = urutan `sortLabels` untuk
 * `[a-z0-9-]`) agar urutan dan potongan `limit` sama di semua lingkungan.
 */
export async function listCaseLabels(db: Queryable, projectId: string, limit: number): Promise<string[]> {
  const rows = await db
    .select({ label: manualCaseLabels.label })
    .from(manualCaseLabels)
    .innerJoin(manualCases, eq(manualCases.id, manualCaseLabels.caseId))
    .where(eq(manualCases.projectId, projectId))
    .groupBy(manualCaseLabels.label)
    .orderBy(sql`${manualCaseLabels.label} collate "C"`)
    .limit(limit);
  return rows.map((row) => row.label);
}

/** Cari automated test project ini berdasarkan nama atau suite (tidak peka huruf besar/kecil, `%`/`_` literal). */
export async function searchTests(
  db: Queryable,
  projectId: string,
  q: string,
  limit: number,
): Promise<TestSearchItemDto[]> {
  const pattern = `%${escapeLike(q)}%`;
  return db
    .select({ id: testCases.id, suite: testCases.suite, name: testCases.name })
    .from(testCases)
    .where(
      and(
        eq(testCases.projectId, projectId),
        sql`(${testCases.name} ilike ${pattern} escape '\\' or ${testCases.suite} ilike ${pattern} escape '\\')`,
      ),
    )
    .orderBy(asc(testCases.suite), asc(testCases.name))
    .limit(limit);
}
