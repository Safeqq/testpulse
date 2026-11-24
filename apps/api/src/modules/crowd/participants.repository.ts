import type { CrowdReportCountsDto, CrowdReportStatus, ParticipantDto, ParticipantStatus } from "@testpulse/shared";
import { and, asc, count, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { crowdParticipants, crowdReports, users } from "../../db/schema.js";
import { EMPTY_REPORT_COUNTS } from "./cycles.repository.js";

/** `joinedAt` dalam mikrodetik epoch: presisi penuh timestamptz, agar keyset tidak mengulang atau melewati baris. */
export interface ParticipantCursor {
  joinedAt: number;
  userId: string;
}

const joinedAtMicros = sql<string>`(extract(epoch from ${crowdParticipants.joinedAt}) * 1000000)::bigint`;

/** Peserta cycle urut waktu bergabung (lalu id pengguna), dengan hitungan laporan per status; tanpa email. */
export async function listParticipants(
  db: Queryable,
  opts: { cycleId: string; status?: ParticipantStatus; after?: ParticipantCursor; limit: number },
): Promise<(ParticipantDto & { cursor: ParticipantCursor })[]> {
  const conditions: (SQL | undefined)[] = [eq(crowdParticipants.cycleId, opts.cycleId)];
  if (opts.status !== undefined) conditions.push(eq(crowdParticipants.status, opts.status));
  if (opts.after !== undefined) {
    const at = opts.after.joinedAt;
    conditions.push(
      or(
        sql`${joinedAtMicros} > ${at}`,
        and(sql`${joinedAtMicros} = ${at}`, gt(crowdParticipants.userId, opts.after.userId)),
      ),
    );
  }
  const rows = await db
    .select({
      userId: crowdParticipants.userId,
      name: users.name,
      status: crowdParticipants.status,
      joinedAt: crowdParticipants.joinedAt,
      joinedAtMicros: joinedAtMicros.mapWith(Number),
    })
    .from(crowdParticipants)
    .innerJoin(users, eq(users.id, crowdParticipants.userId))
    .where(and(...conditions))
    .orderBy(asc(crowdParticipants.joinedAt), asc(crowdParticipants.userId))
    .limit(opts.limit);

  const counts = new Map<string, CrowdReportCountsDto>(rows.map((r) => [r.userId, { ...EMPTY_REPORT_COUNTS }]));
  if (rows.length > 0) {
    const grouped = await db
      .select({ reporterId: crowdReports.reporterId, status: crowdReports.status, n: count() })
      .from(crowdReports)
      .where(
        and(
          eq(crowdReports.cycleId, opts.cycleId),
          inArray(
            crowdReports.reporterId,
            rows.map((r) => r.userId),
          ),
        ),
      )
      .groupBy(crowdReports.reporterId, crowdReports.status);
    for (const g of grouped) counts.get(g.reporterId)![g.status as CrowdReportStatus] = g.n;
  }

  return rows.map((r) => ({
    user: { id: r.userId, name: r.name },
    status: r.status,
    joinedAt: r.joinedAt.toISOString(),
    reportCounts: counts.get(r.userId)!,
    cursor: { joinedAt: r.joinedAtMicros, userId: r.userId },
  }));
}

/** Mengeluarkan peserta (spec §4); `false` bila pengguna bukan peserta cycle ini. */
export async function removeParticipant(
  db: Db,
  input: { cycleId: string; userId: string; actorId: string; reason: string | null },
): Promise<boolean> {
  const updated = await db
    .update(crowdParticipants)
    .set({
      status: "removed",
      removedAt: sql`statement_timestamp()`,
      removedBy: input.actorId,
      removalReason: input.reason,
    })
    .where(and(eq(crowdParticipants.cycleId, input.cycleId), eq(crowdParticipants.userId, input.userId)))
    .returning({ userId: crowdParticipants.userId });
  return updated.length > 0;
}
