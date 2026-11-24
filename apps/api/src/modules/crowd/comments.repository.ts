import type { CrowdCommentDto } from "@testpulse/shared";
import { and, asc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { crowdReportComments, users } from "../../db/schema.js";

/** Komentar laporan crowd (spec §5.6): satu thread untuk pelapor dan tim, tanpa edit, hapus = soft delete. */

export interface CommentCursor {
  at: number;
  id: string;
}

const createdMicros = sql<number>`(extract(epoch from ${crowdReportComments.createdAt}) * 1000000)::bigint`;

function toDto(row: { id: string; authorId: string; authorName: string; body: string; createdAt: Date; deletedAt: Date | null }): CrowdCommentDto {
  return {
    id: row.id,
    author: { id: row.authorId, name: row.authorName },
    body: row.deletedAt === null ? row.body : null,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
  };
}

const commentColumns = {
  id: crowdReportComments.id,
  authorId: crowdReportComments.authorId,
  authorName: users.name,
  body: crowdReportComments.body,
  createdAt: crowdReportComments.createdAt,
  deletedAt: crowdReportComments.deletedAt,
};

/** Komentar urut lama → baru. */
export async function listComments(
  db: Queryable,
  opts: { reportId: string; after?: CommentCursor; limit: number },
): Promise<(CrowdCommentDto & { cursor: CommentCursor })[]> {
  const conditions: (SQL | undefined)[] = [eq(crowdReportComments.reportId, opts.reportId)];
  if (opts.after) {
    conditions.push(
      or(
        sql`${createdMicros} > ${opts.after.at}`,
        and(sql`${createdMicros} = ${opts.after.at}`, gt(crowdReportComments.id, opts.after.id)),
      ),
    );
  }
  const rows = await db
    .select({ ...commentColumns, at: createdMicros.mapWith(Number) })
    .from(crowdReportComments)
    .innerJoin(users, eq(users.id, crowdReportComments.authorId))
    .where(and(...conditions))
    .orderBy(asc(crowdReportComments.createdAt), asc(crowdReportComments.id))
    .limit(opts.limit);
  return rows.map((r) => ({ ...toDto(r), cursor: { at: r.at, id: r.id } }));
}

export async function addComment(db: Db, input: { reportId: string; authorId: string; body: string }): Promise<CrowdCommentDto> {
  const [row] = await db
    .insert(crowdReportComments)
    .values({ reportId: input.reportId, authorId: input.authorId, body: input.body, createdAt: sql`statement_timestamp()` })
    .returning({ id: crowdReportComments.id });
  const [comment] = await db
    .select(commentColumns)
    .from(crowdReportComments)
    .innerJoin(users, eq(users.id, crowdReportComments.authorId))
    .where(eq(crowdReportComments.id, row!.id));
  return toDto(comment!);
}

/** Soft delete komentar milik `authorId`; `not_found` bila tidak ada di laporan ini, `forbidden` bila milik orang lain. */
export async function deleteComment(
  db: Db,
  input: { reportId: string; commentId: string; authorId: string },
): Promise<"ok" | "not_found" | "forbidden"> {
  const [comment] = await db
    .select({ authorId: crowdReportComments.authorId })
    .from(crowdReportComments)
    .where(and(eq(crowdReportComments.id, input.commentId), eq(crowdReportComments.reportId, input.reportId)));
  if (!comment) return "not_found";
  if (comment.authorId !== input.authorId) return "forbidden";
  await db
    .update(crowdReportComments)
    .set({ deletedAt: sql`statement_timestamp()` })
    .where(and(eq(crowdReportComments.id, input.commentId), isNull(crowdReportComments.deletedAt)));
  return "ok";
}
