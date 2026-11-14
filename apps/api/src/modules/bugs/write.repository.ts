import type { BugDto, BugResolution, BugStatus, CreateBugBody, UpdateBugBody } from "@testpulse/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Db, Queryable } from "../../db/client.js";
import {
  bugEvents,
  bugLabels,
  bugLinks,
  bugs,
  manualRunCases,
  manualRuns,
  memberships,
  projects,
  runs,
  testCases,
  testResults,
  users,
} from "../../db/schema.js";
import { applyStatusChange } from "./domain/transitions.js";
import { bugByNumber, labelsByBug, loadBugDto, sortLabels } from "./read.repository.js";

/*
 * Urutan kunci baris di jalur tulis bug: project → membership → asal bug (`test_cases`/`runs`, dan `manual_run_cases`
 * `FOR KEY SHARE` untuk bug dari run manual) → bug. Penghapusan project mengunci baris project lebih dulu lalu menghapus
 * anak-anaknya (cascade), jadi jalur buat/ubah yang mengunci project di awal menunggu di sana alih-alih saling mengunci
 * dengan cascade. Penulisan hasil run case (run-cases.repository.ts) memakai urutan yang sama, project lalu run case
 * `FOR UPDATE`, jadi pembuatan bug dari run case dan penulisan hasilnya hanya saling menunggu, tidak saling mengunci.
 * Pengeluaran anggota (`changeMemberRole`) mengunci membership lalu bug, sesuai urutan yang sama. Jalur lain di luar
 * modul ini (mis. hapus project vs keluarkan anggota) tidak dijamin bebas deadlock; Postgres membatalkan salah satu
 * transaksi bila itu terjadi.
 */

type BugRow = typeof bugs.$inferSelect;
type BugChanges = PgUpdateSetSource<typeof bugs>;
type EventInput = { field: string; oldValue: string | null; newValue: string | null };

/**
 * Anggota project (role apa pun)? Baris membership dikunci `FOR KEY SHARE` sampai transaksi selesai, sehingga
 * pengeluaran anggota yang berjalan bersamaan menunggu dan kemudian ikut mengosongkan assignee bug ini (atau
 * menang lebih dulu, lalu pemanggil mendapat 400).
 */
async function lockMembership(tx: Queryable, projectId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)))
    .for("key share");
  return row !== undefined;
}

async function insertLabels(tx: Queryable, bugId: string, labels: readonly string[]): Promise<void> {
  if (labels.length > 0) await tx.insert(bugLabels).values(labels.map((label) => ({ bugId, label })));
}

async function insertLinks(tx: Queryable, bugId: string, links: readonly { url: string; title?: string | undefined }[]) {
  if (links.length === 0) return;
  await tx
    .insert(bugLinks)
    .values(links.map((link, position) => ({ bugId, position, url: link.url, title: link.title ?? null })));
}

export type CreateBugFailure =
  | "project_not_found"
  | "assignee_not_member"
  | "test_case_not_found"
  | "run_not_found"
  | "manual_run_case_not_found";

/**
 * Membuat bug dalam satu transaksi. Baris project dikunci lebih dulu (`FOR NO KEY UPDATE`); nomor diambil dari
 * `projects.bug_seq` (`UPDATE … RETURNING`), jadi pembuatan paralel tetap unik dan berurutan dan nomor tidak pernah
 * dipakai ulang. Label & link disimpan dalam transaksi yang sama. Kegagalan validasi dikembalikan sebelum
 * `bug_seq` dinaikkan.
 */
export async function createBug(
  db: Db,
  input: { projectId: string; reporterId: string; body: CreateBugBody },
): Promise<BugDto | CreateBugFailure> {
  const { projectId, reporterId, body } = input;
  return db.transaction(async (tx) => {
    // Project terhapus setelah rute memeriksa akses → 404, bukan 500.
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("no key update");
    if (!project) return "project_not_found";

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
    if (body.manualRunCaseId !== undefined) {
      // Run case dari run manual project ini (spec Tahap 4 §5.4); dikunci agar run-nya tidak terhapus di sela-sela.
      const [runCase] = await tx
        .select({ id: manualRunCases.id })
        .from(manualRunCases)
        .innerJoin(manualRuns, eq(manualRuns.id, manualRunCases.runId))
        .where(and(eq(manualRunCases.id, body.manualRunCaseId), eq(manualRuns.projectId, projectId)))
        .for("key share", { of: manualRunCases });
      if (!runCase) return "manual_run_case_not_found";
    }

    const [seq] = await tx
      .update(projects)
      .set({ bugSeq: sql`${projects.bugSeq} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ bugSeq: projects.bugSeq });
    if (!seq) return "project_not_found";

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
        manualRunCaseId: body.manualRunCaseId ?? null,
      })
      .returning({ id: bugs.id });
    if (!bug) throw new Error("insert bug tidak mengembalikan baris");

    await insertLabels(tx, bug.id, body.labels ?? []);
    await insertLinks(tx, bug.id, body.links ?? []);
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

const labelsValue = (labels: readonly string[]) => (labels.length > 0 ? labels.join(", ") : null);
const linksKey = (links: readonly { url: string; title?: string | null | undefined }[]) =>
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
    // Nomor tak dikenal → 404 lebih dulu daripada validasi assignee (pencarian tanpa kunci).
    const [exists] = await tx.select({ id: bugs.id }).from(bugs).where(bugByNumber(projectId, number));
    if (!exists) return "not_found";

    // Urutan kunci: project → membership → bug (lihat komentar di atas berkas).
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("key share");
    if (!project) return "not_found";
    if (body.assigneeId && !(await lockMembership(tx, projectId, body.assigneeId))) return "assignee_not_member";

    const [bug] = await tx.select().from(bugs).where(bugByNumber(projectId, number)).for("update");
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

    // Kedua sisi diurutkan dengan `sortLabels` (JS), tidak bergantung pada collation database.
    let newLabels: string[] | undefined;
    if (body.labels !== undefined) {
      const current = (await labelsByBug(tx, [bug.id])).get(bug.id) ?? [];
      const next = sortLabels(body.labels);
      if (JSON.stringify(next) !== JSON.stringify(current)) {
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
      await insertLabels(tx, bug.id, newLabels);
    }
    if (linksChanged && body.links !== undefined) {
      await tx.delete(bugLinks).where(eq(bugLinks.bugId, bug.id));
      await insertLinks(tx, bug.id, body.links);
    }
    await tx.insert(bugEvents).values(events.map((event) => ({ ...event, bugId: bug.id, actorId })));
    return loadBugDto(tx, bug.id);
  });
}

/** Menghapus bug (label, link, komentar, event ikut terhapus). False bila nomor tidak ada di project ini. */
export async function deleteBug(db: Db, projectId: string, number: number): Promise<boolean> {
  const deleted = await db.delete(bugs).where(bugByNumber(projectId, number)).returning({ id: bugs.id });
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
