import type {
  BugDto,
  BugListQuery,
  BugPriority,
  BugResolution,
  BugSeverity,
  BugStatus,
  BugSummaryDto,
  CreateBugBody,
  UpdateBugBody,
} from "@testpulse/shared";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias, type PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Db, Queryable } from "../../db/client.js";
import { bugEvents, bugLabels, bugLinks, bugs, memberships, projects, runs, testCases, testResults, users } from "../../db/schema.js";
import type { BugCursor, BugSort } from "./cursor.js";
import { applyStatusChange } from "./domain/transitions.js";

type BugRow = typeof bugs.$inferSelect;
type BugChanges = PgUpdateSetSource<typeof bugs>;
type EventInput = { field: string; oldValue: string | null; newValue: string | null };

const assigneeUser = alias(users, "assignee");
const reporterUser = alias(users, "reporter");

/** Peringkat prioritas untuk `sort=priority` (urgent dulu); sama dengan `rank` di cursor. */
const priorityRank = sql<number>`(case ${bugs.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 else 1 end)`;

/** Waktu sebagai teks ISO UTC berpresisi mikrodetik (presisi penuh kolom), untuk cursor keyset. */
const microIso = (column: SQLWrapper) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// ---------------------------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------------------------

const summaryColumns = {
  id: bugs.id,
  number: bugs.number,
  title: bugs.title,
  status: bugs.status,
  resolution: bugs.resolution,
  priority: bugs.priority,
  severity: bugs.severity,
  assigneeId: bugs.assigneeId,
  assigneeName: assigneeUser.name,
  createdAt: bugs.createdAt,
  updatedAt: bugs.updatedAt,
};

type SummaryRow = {
  number: number;
  title: string;
  status: string;
  resolution: string | null;
  priority: string;
  severity: string;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Kolom enum dibatasi CHECK constraint (spec §5). Email user tidak pernah dipilih.
function toSummary(row: SummaryRow, labels: string[]): BugSummaryDto {
  return {
    number: row.number,
    title: row.title,
    status: row.status as BugStatus,
    resolution: row.resolution as BugResolution | null,
    priority: row.priority as BugPriority,
    severity: row.severity as BugSeverity,
    assignee: row.assigneeId !== null && row.assigneeName !== null ? { id: row.assigneeId, name: row.assigneeName } : null,
    labels,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Label per bug (urut abjad) dengan satu query. */
async function labelsByBug(db: Queryable, bugIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(bugIds.map((id) => [id, []]));
  if (bugIds.length === 0) return out;
  const rows = await db
    .select({ bugId: bugLabels.bugId, label: bugLabels.label })
    .from(bugLabels)
    .where(inArray(bugLabels.bugId, bugIds))
    .orderBy(asc(bugLabels.label));
  for (const row of rows) out.get(row.bugId)?.push(row.label);
  return out;
}

/** Detail bug (spec §6). `testHint` diisi Task 6; di sini selalu `null`. */
async function loadBugDto(db: Queryable, bugId: string): Promise<BugDto> {
  const [row] = await db
    .select({
      ...summaryColumns,
      description: bugs.description,
      reporterId: bugs.reporterId,
      reporterName: reporterUser.name,
      testCaseId: testCases.id,
      testCaseSuite: testCases.suite,
      testCaseName: testCases.name,
      runId: bugs.runId,
      version: bugs.version,
      resolvedAt: bugs.resolvedAt,
      closedAt: bugs.closedAt,
    })
    .from(bugs)
    .innerJoin(reporterUser, eq(reporterUser.id, bugs.reporterId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, bugs.assigneeId))
    .leftJoin(testCases, eq(testCases.id, bugs.testCaseId))
    .where(eq(bugs.id, bugId));
  if (!row) throw new Error("bug hilang di tengah transaksi");

  const labels = (await labelsByBug(db, [bugId])).get(bugId) ?? [];
  const links = await db
    .select({ url: bugLinks.url, title: bugLinks.title })
    .from(bugLinks)
    .where(eq(bugLinks.bugId, bugId))
    .orderBy(asc(bugLinks.position));

  return {
    ...toSummary(row, labels),
    description: row.description,
    reporter: { id: row.reporterId, name: row.reporterName },
    links,
    testCase:
      row.testCaseId !== null && row.testCaseSuite !== null && row.testCaseName !== null
        ? { id: row.testCaseId, suite: row.testCaseSuite, name: row.testCaseName }
        : null,
    runId: row.runId,
    version: row.version,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    testHint: null,
  };
}

const byNumber = (projectId: string, number: number) => and(eq(bugs.projectId, projectId), eq(bugs.number, number));

export async function findBugByNumber(db: Queryable, projectId: string, number: number): Promise<BugDto | null> {
  const [row] = await db.select({ id: bugs.id }).from(bugs).where(byNumber(projectId, number));
  return row ? loadBugDto(db, row.id) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------------------------

/**
 * Anggota project (role apa pun)? Baris membership dikunci `FOR KEY SHARE` sampai transaksi selesai, sehingga
 * pengeluaran anggota yang berjalan bersamaan menunggu dan kemudian ikut mengosongkan assignee bug ini.
 * Urutan kunci di seluruh modul: membership dulu, baru baris bug (sama dengan `changeMemberRole`) — tanpa deadlock.
 */
async function lockMembership(tx: Queryable, projectId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)))
    .for("key share");
  return row !== undefined;
}

async function insertLabelsAndLinks(
  tx: Queryable,
  bugId: string,
  labels: string[] | undefined,
  links: { url: string; title?: string | undefined }[] | undefined,
): Promise<void> {
  if (labels && labels.length > 0) await tx.insert(bugLabels).values(labels.map((label) => ({ bugId, label })));
  if (links && links.length > 0) {
    await tx
      .insert(bugLinks)
      .values(links.map((link, position) => ({ bugId, position, url: link.url, title: link.title ?? null })));
  }
}

export type CreateBugFailure = "assignee_not_member" | "test_case_not_found" | "run_not_found";

/**
 * Membuat bug dalam satu transaksi. Nomor diambil dari `projects.bug_seq` (`UPDATE … RETURNING` mengunci baris
 * project, jadi pembuatan paralel tetap unik dan berurutan; nomor tidak pernah dipakai ulang). Label & link
 * disimpan dalam transaksi yang sama.
 */
export async function createBug(
  db: Db,
  input: { projectId: string; reporterId: string; body: CreateBugBody },
): Promise<BugDto | CreateBugFailure> {
  const { projectId, reporterId, body } = input;
  return db.transaction(async (tx) => {
    if (body.assigneeId && !(await lockMembership(tx, projectId, body.assigneeId))) return "assignee_not_member";

    if (body.testCaseId !== undefined) {
      const [testCase] = await tx
        .select({ id: testCases.id })
        .from(testCases)
        .where(and(eq(testCases.id, body.testCaseId), eq(testCases.projectId, projectId)))
        .for("key share");
      if (!testCase) return "test_case_not_found";
    }
    if (body.runId !== undefined) {
      // Run milik project ini dan memuat hasil test tersebut (spec §6.1); dikunci agar tidak terhapus di sela-sela.
      // `runId` tanpa `testCaseId` sudah ditolak skema; dicek lagi agar query di bawah selalu bertipe benar.
      const testCaseId = body.testCaseId;
      if (testCaseId === undefined) return "run_not_found";
      const [run] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, body.runId), eq(runs.projectId, projectId)))
        .for("key share");
      const [result] = run
        ? await tx
            .select({ id: testResults.id })
            .from(testResults)
            .where(and(eq(testResults.runId, run.id), eq(testResults.testCaseId, testCaseId)))
            .limit(1)
        : [];
      if (!result) return "run_not_found";
    }

    const [seq] = await tx
      .update(projects)
      .set({ bugSeq: sql`${projects.bugSeq} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ bugSeq: projects.bugSeq });
    if (!seq) throw new Error("project hilang saat membuat bug");

    const [bug] = await tx
      .insert(bugs)
      .values({
        projectId,
        number: seq.bugSeq,
        title: body.title,
        description: body.description ?? "",
        status: "open",
        priority: body.priority ?? "medium",
        severity: body.severity ?? "major",
        assigneeId: body.assigneeId ?? null,
        reporterId,
        testCaseId: body.testCaseId ?? null,
        runId: body.runId ?? null,
      })
      .returning({ id: bugs.id });
    if (!bug) throw new Error("insert bug tidak mengembalikan baris");

    await insertLabelsAndLinks(tx, bug.id, body.labels, body.links);
    return loadBugDto(tx, bug.id);
  });
}

export type UpdateBugFailure =
  | "not_found"
  | "conflict"
  | "invalid_transition"
  | "resolution_required"
  | "resolution_not_allowed"
  | "assignee_not_member";

const labelsValue = (labels: string[]) => (labels.length > 0 ? labels.join(", ") : null);
const linksKey = (links: { url: string; title?: string | null | undefined }[]) =>
  JSON.stringify(links.map((link) => [link.url, link.title ?? null]));

async function userNames(tx: Queryable, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = ids.filter((id): id is string => id !== null);
  if (wanted.length === 0) return new Map();
  const rows = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, wanted));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Status & resolusi (spec §3.2). Mengisi `changes`/`events`; mengembalikan kegagalan bila perubahan tidak sah.
 * Status yang sama dengan sekarang diperlakukan seperti tidak dikirim.
 */
function applyStatusAndResolution(
  bug: BugRow,
  body: UpdateBugBody,
  changes: BugChanges,
  events: EventInput[],
): UpdateBugFailure | null {
  const current = { status: bug.status as BugStatus, resolution: bug.resolution as BugResolution | null };

  if (body.status !== undefined && body.status !== current.status) {
    const result = applyStatusChange(
      current,
      body.resolution !== undefined ? { status: body.status, resolution: body.resolution } : { status: body.status },
      // Hanya menandai tanggal mana yang berubah; nilainya diganti `now()` database di bawah.
      new Date(),
    );
    if ("error" in result) return result.error === "INVALID_TRANSITION" ? "invalid_transition" : "resolution_required";
    changes.status = result.status;
    events.push({ field: "status", oldValue: current.status, newValue: result.status });
    if (result.resolution !== current.resolution) {
      changes.resolution = result.resolution;
      events.push({ field: "resolution", oldValue: current.resolution, newValue: result.resolution });
    }
    // Tanggal memakai waktu transaksi database (sama dengan `updated_at` dan `created_at` event).
    if (result.resolvedAt !== undefined) changes.resolvedAt = result.resolvedAt && sql`now()`;
    if (result.closedAt !== undefined) changes.closedAt = result.closedAt && sql`now()`;
    return null;
  }

  if (body.resolution !== undefined && body.resolution !== current.resolution) {
    // Tanpa perubahan status: resolusi hanya bermakna (dan wajib ada) untuk bug resolved/closed.
    if (current.status === "open" || current.status === "in_progress") return "resolution_not_allowed";
    if (body.resolution === null) return "resolution_required";
    changes.resolution = body.resolution;
    events.push({ field: "resolution", oldValue: current.resolution, newValue: body.resolution });
  }
  return null;
}

/**
 * Mengubah bug dalam satu transaksi (spec §3.3): kunci baris bug (`FOR UPDATE`), cek `version`, abaikan field yang
 * nilainya sama, tulis satu `bug_events` per field yang berubah (deskripsi & link tanpa nilai), naikkan `version`
 * dan `updated_at` hanya bila ada perubahan. Kegagalan apa pun membatalkan seluruh transaksi.
 */
export async function updateBug(
  db: Db,
  input: { projectId: string; number: number; actorId: string; body: UpdateBugBody },
): Promise<BugDto | UpdateBugFailure> {
  const { projectId, number, actorId, body } = input;

  return db.transaction(async (tx): Promise<BugDto | UpdateBugFailure> => {
    // Membership dikunci sebelum baris bug (urutan kunci yang sama dengan pengeluaran anggota).
    if (body.assigneeId && !(await lockMembership(tx, projectId, body.assigneeId))) return "assignee_not_member";

    const [bug] = await tx.select().from(bugs).where(byNumber(projectId, number)).for("update");
    if (!bug) return "not_found";
    if (bug.version !== body.version) return "conflict";

    const changes: BugChanges = {};
    const events: EventInput[] = [];

    if (body.title !== undefined && body.title !== bug.title) {
      changes.title = body.title;
      events.push({ field: "title", oldValue: bug.title, newValue: body.title });
    }
    if (body.description !== undefined && body.description !== bug.description) {
      changes.description = body.description;
      events.push({ field: "description", oldValue: null, newValue: null });
    }
    if (body.priority !== undefined && body.priority !== bug.priority) {
      changes.priority = body.priority;
      events.push({ field: "priority", oldValue: bug.priority, newValue: body.priority });
    }
    if (body.severity !== undefined && body.severity !== bug.severity) {
      changes.severity = body.severity;
      events.push({ field: "severity", oldValue: bug.severity, newValue: body.severity });
    }
    if (body.assigneeId !== undefined && body.assigneeId !== bug.assigneeId) {
      changes.assigneeId = body.assigneeId;
      const names = await userNames(tx, [bug.assigneeId, body.assigneeId]);
      events.push({
        field: "assignee",
        oldValue: bug.assigneeId === null ? null : (names.get(bug.assigneeId) ?? null),
        newValue: body.assigneeId === null ? null : (names.get(body.assigneeId) ?? null),
      });
    }

    let newLabels: string[] | undefined;
    if (body.labels !== undefined) {
      const current = (await labelsByBug(tx, [bug.id])).get(bug.id) ?? [];
      const next = body.labels.toSorted();
      if (next.join("\u0000") !== current.join("\u0000")) {
        newLabels = next;
        events.push({ field: "labels", oldValue: labelsValue(current), newValue: labelsValue(next) });
      }
    }

    let linksChanged = false;
    if (body.links !== undefined) {
      const current = await tx
        .select({ url: bugLinks.url, title: bugLinks.title })
        .from(bugLinks)
        .where(eq(bugLinks.bugId, bug.id))
        .orderBy(asc(bugLinks.position));
      if (linksKey(body.links) !== linksKey(current)) {
        linksChanged = true;
        events.push({ field: "links", oldValue: null, newValue: null });
      }
    }

    const failure = applyStatusAndResolution(bug, body, changes, events);
    if (failure) return failure;

    if (events.length === 0) return loadBugDto(tx, bug.id);

    await tx
      .update(bugs)
      .set({ ...changes, version: sql`${bugs.version} + 1`, updatedAt: sql`now()` })
      .where(eq(bugs.id, bug.id));
    if (newLabels !== undefined) {
      await tx.delete(bugLabels).where(eq(bugLabels.bugId, bug.id));
      await insertLabelsAndLinks(tx, bug.id, newLabels, undefined);
    }
    if (linksChanged) {
      await tx.delete(bugLinks).where(eq(bugLinks.bugId, bug.id));
      await insertLabelsAndLinks(tx, bug.id, undefined, body.links);
    }
    await tx.insert(bugEvents).values(events.map((event) => ({ ...event, bugId: bug.id, actorId })));
    return loadBugDto(tx, bug.id);
  });
}

/** Menghapus bug (label, link, komentar, event ikut terhapus). False bila nomor tidak ada di project ini. */
export async function deleteBug(db: Db, projectId: string, number: number): Promise<boolean> {
  const deleted = await db.delete(bugs).where(byNumber(projectId, number)).returning({ id: bugs.id });
  return deleted.length > 0;
}

/**
 * Dipanggil di dalam transaksi penghapusan membership (keluar sendiri / dikeluarkan, spec §3.3): mengosongkan
 * assignee semua bug project itu yang di-assign ke `userId`, dengan satu event `assignee` per bug (actor =
 * `actorId`). Perubahan ini juga menaikkan `version` & `updated_at`, sehingga editor dengan versi lama mendapat 409.
 */
export async function clearAssigneeOnLeave(
  tx: Queryable,
  projectId: string,
  userId: string,
  actorId: string,
): Promise<void> {
  const cleared = await tx
    .update(bugs)
    .set({ assigneeId: null, version: sql`${bugs.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(bugs.projectId, projectId), eq(bugs.assigneeId, userId)))
    .returning({ id: bugs.id });
  if (cleared.length === 0) return;

  const name = (await userNames(tx, [userId])).get(userId) ?? null;
  await tx
    .insert(bugEvents)
    .values(cleared.map(({ id }) => ({ bugId: id, actorId, field: "assignee", oldValue: name, newValue: null })));
}

// ---------------------------------------------------------------------------------------------------------------
// Baca daftar
// ---------------------------------------------------------------------------------------------------------------

const STATUS_FILTER: Record<string, readonly BugStatus[]> = {
  active: ["open", "in_progress"],
  done: ["resolved", "closed"],
};

/** `%`, `_` dan `\` dicocokkan literal pada ILIKE (escape `\`). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface ListBugsOptions {
  projectId: string;
  /** User yang login (untuk `assignee=me`); anonim + `me` = tidak ada bug yang cocok. */
  userId: string | null;
  query: Omit<BugListQuery, "cursor">;
  after?: BugCursor;
  limit: number;
}

/**
 * Satu halaman daftar bug sesuai filter & urutan (spec §6), dengan posisi keyset tiap bug untuk cursor.
 * Urutan: `updated` = `updated_at desc, id desc`; `created` = `created_at desc, id desc`;
 * `priority` = peringkat desc, `updated_at desc, id desc`.
 */
export async function listBugs(
  db: Queryable,
  opts: ListBugsOptions,
): Promise<{ bug: BugSummaryDto; position: BugCursor }[]> {
  const { query } = opts;
  const conditions: SQL[] = [eq(bugs.projectId, opts.projectId)];

  if (query.status !== "all") {
    const statuses = STATUS_FILTER[query.status] ?? [query.status];
    conditions.push(inArray(bugs.status, [...statuses]));
  }
  if (query.assignee === "none") conditions.push(isNull(bugs.assigneeId));
  else if (query.assignee === "me") conditions.push(opts.userId ? eq(bugs.assigneeId, opts.userId) : sql`false`);
  else if (query.assignee !== undefined) conditions.push(eq(bugs.assigneeId, query.assignee));
  if (query.priority !== undefined) conditions.push(eq(bugs.priority, query.priority));
  if (query.severity !== undefined) conditions.push(eq(bugs.severity, query.severity));
  if (query.label !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${bugLabels} where ${bugLabels.bugId} = ${bugs.id} and ${bugLabels.label} = ${query.label})`,
    );
  }
  if (query.q !== undefined) conditions.push(sql`${bugs.title} ilike ${`%${escapeLike(query.q)}%`} escape '\\'`);

  const sort: BugSort = query.sort;
  const timeColumn = sort === "created" ? bugs.createdAt : bugs.updatedAt;
  if (opts.after) {
    const { at, id, rank } = opts.after;
    conditions.push(
      sort === "priority"
        ? sql`(${priorityRank}, ${timeColumn}, ${bugs.id}) < (${rank}::int, ${at}::timestamptz, ${id}::uuid)`
        : sql`(${timeColumn}, ${bugs.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }

  const order = sort === "priority" ? [desc(priorityRank), desc(timeColumn), desc(bugs.id)] : [desc(timeColumn), desc(bugs.id)];
  const rows = await db
    .select({ ...summaryColumns, at: microIso(timeColumn), rank: priorityRank })
    .from(bugs)
    .leftJoin(assigneeUser, eq(assigneeUser.id, bugs.assigneeId))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit);

  const labels = await labelsByBug(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    bug: toSummary(row, labels.get(row.id) ?? []),
    position: sort === "priority" ? { at: row.at, id: row.id, rank: Number(row.rank) } : { at: row.at, id: row.id },
  }));
}

/** Label yang dipakai bug project ini, unik dan urut abjad. */
export async function listLabels(db: Queryable, projectId: string, limit: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ label: bugLabels.label })
    .from(bugLabels)
    .innerJoin(bugs, eq(bugs.id, bugLabels.bugId))
    .where(eq(bugs.projectId, projectId))
    .orderBy(asc(bugLabels.label))
    .limit(limit);
  return rows.map((row) => row.label);
}
