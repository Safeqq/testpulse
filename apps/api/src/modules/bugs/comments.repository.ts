import type { ActivityItemDto, CommentDto } from "@testpulse/shared";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { bugComments, bugEvents, bugs, users } from "../../db/schema.js";
import type { ActivityCursor } from "./activity-cursor.js";
import { bugByNumber, microIso } from "./read.repository.js";

/**
 * Komentar & linimasa aktivitas bug (spec Tahap 3 §3.4, §6). Email user tidak pernah dipilih: hanya `id` dan `name`.
 * Jalur tulis mengunci baris komentar/bug yang dipakai dalam transaksi yang sama, agar hapus bersamaan (bug atau
 * komentar) menghasilkan 404 alih-alih pelanggaran foreign key.
 */

const commentColumns = {
  id: bugComments.id,
  authorId: bugComments.authorId,
  authorName: users.name,
  body: bugComments.body,
  createdAt: bugComments.createdAt,
  editedAt: bugComments.editedAt,
  deletedAt: bugComments.deletedAt,
};

type CommentRow = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

/** Komentar terhapus ditampilkan tanpa isi (`body: null`). */
function toCommentDto(row: CommentRow): CommentDto {
  return {
    id: row.id,
    author: { id: row.authorId, name: row.authorName },
    body: row.deletedAt === null ? row.body : null,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

async function loadComment(db: Queryable, commentId: string): Promise<CommentDto> {
  const [row] = await db
    .select(commentColumns)
    .from(bugComments)
    .innerJoin(users, eq(users.id, bugComments.authorId))
    .where(eq(bugComments.id, commentId));
  if (!row) throw new Error("komentar hilang di tengah transaksi");
  return toCommentDto(row);
}

/** Id bug di project ini menurut nomornya, atau `null`. */
export async function findBugId(db: Queryable, projectId: string, number: number): Promise<string | null> {
  const [row] = await db.select({ id: bugs.id }).from(bugs).where(bugByNumber(projectId, number));
  return row?.id ?? null;
}

/**
 * Menambah komentar; `null` bila bug tidak ada (atau terhapus bersamaan). Komentar baru menaikkan `updated_at` bug
 * (bug dengan diskusi aktif muncul di urutan teratas) dalam transaksi yang sama; `version` tidak berubah dan tidak ada
 * event, sehingga editor yang sedang membuka bug tidak mendapat konflik. UPDATE ini sekaligus mengunci baris bug.
 */
export async function createComment(
  db: Db,
  input: { projectId: string; number: number; authorId: string; body: string },
): Promise<CommentDto | null> {
  return db.transaction(async (tx) => {
    const [bug] = await tx
      .update(bugs)
      .set({ updatedAt: sql`now()` })
      .where(bugByNumber(input.projectId, input.number))
      .returning({ id: bugs.id });
    if (!bug) return null;
    const [created] = await tx
      .insert(bugComments)
      .values({ bugId: bug.id, authorId: input.authorId, body: input.body })
      .returning({ id: bugComments.id });
    if (!created) throw new Error("insert komentar tidak mengembalikan baris");
    return loadComment(tx, created.id);
  });
}

export type CommentMutationFailure = "not_found" | "forbidden";

interface CommentTarget {
  projectId: string;
  number: number;
  commentId: string;
  actorId: string;
}

/** Mengunci komentar milik bug bernomor `number` di project ini; `null` bila tidak ada. */
async function lockComment(tx: Queryable, target: CommentTarget) {
  const [row] = await tx
    .select({ authorId: bugComments.authorId, body: bugComments.body, deletedAt: bugComments.deletedAt })
    .from(bugComments)
    .innerJoin(bugs, eq(bugs.id, bugComments.bugId))
    .where(and(eq(bugComments.id, target.commentId), bugByNumber(target.projectId, target.number)))
    .for("update", { of: bugComments });
  return row ?? null;
}

/**
 * Mengubah isi komentar (tanpa perubahan isi = tanpa tulis). Hanya penulis; komentar terhapus diperlakukan tidak ada (`not_found`). Pemeriksaan
 * role penulis (masih tester/admin) dilakukan rute lewat izin `bugs:write` sebelum memanggil ini.
 */
export async function editComment(
  db: Db,
  input: CommentTarget & { body: string },
): Promise<CommentDto | CommentMutationFailure> {
  return db.transaction(async (tx) => {
    const comment = await lockComment(tx, input);
    if (!comment || comment.deletedAt !== null) return "not_found";
    if (comment.authorId !== input.actorId) return "forbidden";
    // Isi (setelah trim) tidak berubah: tidak ada yang ditulis, `editedAt` tetap.
    if (comment.body !== input.body) {
      await tx
        .update(bugComments)
        .set({ body: input.body, editedAt: sql`now()` })
        .where(eq(bugComments.id, input.commentId));
    }
    return loadComment(tx, input.commentId);
  });
}

/**
 * Soft delete: isi dikosongkan, `deleted_at` diisi. Penulis atau admin (`isAdmin`). Menghapus komentar yang sudah
 * terhapus tidak mengubah apa pun (idempoten).
 */
export async function deleteComment(
  db: Db,
  input: CommentTarget & { isAdmin: boolean },
): Promise<"deleted" | CommentMutationFailure> {
  return db.transaction(async (tx) => {
    const comment = await lockComment(tx, input);
    if (!comment) return "not_found";
    if (comment.authorId !== input.actorId && !input.isAdmin) return "forbidden";
    if (comment.deletedAt === null) {
      await tx
        .update(bugComments)
        .set({ body: "", deletedAt: sql`now()` })
        .where(eq(bugComments.id, input.commentId));
    }
    return "deleted";
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Linimasa aktivitas
// ---------------------------------------------------------------------------------------------------------------

export interface ActivityRow {
  item: ActivityItemDto;
  position: ActivityCursor;
}

/**
 * Satu halaman linimasa (komentar + event) berurut `(created_at, jenis, id)`: komentar lebih dulu daripada event pada
 * waktu yang sama; `id` komentar menurut urutan uuid, `id` event menurut urutan bilangan. Tiap jenis dibaca dengan
 * predikat keyset sendiri (memakai indeks `(bug_id, created_at)`), lalu digabung; `limit` baris pertama gabungan
 * selalu ada di dalam `limit` baris pertama masing-masing jenis.
 */
export async function listActivity(
  db: Queryable,
  opts: { bugId: string; after?: ActivityCursor; limit: number },
): Promise<ActivityRow[]> {
  const { bugId, after, limit } = opts;

  const commentAfter: SQL | undefined = !after
    ? undefined
    : after.kind === "comment"
      ? sql`(${bugComments.createdAt}, ${bugComments.id}) > (${after.at}::timestamptz, ${after.id}::uuid)`
      : sql`${bugComments.createdAt} > ${after.at}::timestamptz`;
  const eventAfter: SQL | undefined = !after
    ? undefined
    : after.kind === "event"
      ? sql`(${bugEvents.createdAt}, ${bugEvents.id}) > (${after.at}::timestamptz, ${after.id}::bigint)`
      : sql`${bugEvents.createdAt} >= ${after.at}::timestamptz`;

  const [commentRows, eventRows] = await Promise.all([
    db
      .select({ ...commentColumns, at: microIso(bugComments.createdAt) })
      .from(bugComments)
      .innerJoin(users, eq(users.id, bugComments.authorId))
      .where(and(eq(bugComments.bugId, bugId), commentAfter))
      .orderBy(asc(bugComments.createdAt), asc(bugComments.id))
      .limit(limit),
    db
      .select({
        id: bugEvents.id,
        actorId: bugEvents.actorId,
        actorName: users.name,
        field: bugEvents.field,
        oldValue: bugEvents.oldValue,
        newValue: bugEvents.newValue,
        createdAt: bugEvents.createdAt,
        at: microIso(bugEvents.createdAt),
      })
      .from(bugEvents)
      .innerJoin(users, eq(users.id, bugEvents.actorId))
      .where(and(eq(bugEvents.bugId, bugId), eventAfter))
      .orderBy(asc(bugEvents.createdAt), asc(bugEvents.id))
      .limit(limit),
  ]);

  const rows: (ActivityRow & { eventId: bigint | null })[] = [
    ...commentRows.map((row) => ({
      item: { kind: "comment" as const, ...toCommentDto(row) },
      position: { kind: "comment" as const, at: row.at, id: row.id },
      eventId: null,
    })),
    ...eventRows.map((row) => ({
      item: {
        kind: "event" as const,
        id: String(row.id),
        actor: { id: row.actorId, name: row.actorName },
        field: row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
        createdAt: row.createdAt.toISOString(),
      },
      position: { kind: "event" as const, at: row.at, id: String(row.id) },
      eventId: BigInt(row.id),
    })),
  ];

  rows.sort((a, b) => {
    // `at` berformat tetap (ISO UTC 6 digit pecahan), jadi urutan teks = urutan waktu.
    if (a.position.at !== b.position.at) return a.position.at < b.position.at ? -1 : 1;
    if (a.position.kind !== b.position.kind) return a.position.kind === "comment" ? -1 : 1;
    if (a.eventId !== null && b.eventId !== null) return a.eventId < b.eventId ? -1 : 1;
    return a.position.id < b.position.id ? -1 : 1;
  });
  return rows.slice(0, limit).map(({ item, position }) => ({ item, position }));
}
