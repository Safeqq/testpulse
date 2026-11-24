import { LEADERBOARD_SIZE, type LeaderboardDto } from "@testpulse/shared";
import { and, count, eq, max, ne, sql, sum, type SQL } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { crowdCycles, crowdReports, users } from "../../db/schema.js";
import { rankLeaderboard, type LeaderboardRow } from "./domain/reputation.js";

/** Baris leaderboard dari laporan `accepted` yang memenuhi `where`, digabung per pelapor. */
async function leaderboardRows(db: Queryable, where: SQL): Promise<LeaderboardRow[]> {
  const rows = await db
    .select({
      userId: crowdReports.reporterId,
      name: users.name,
      points: sum(crowdReports.points).mapWith(Number),
      accepted: count(),
      reachedAt: max(crowdReports.triagedAt),
    })
    .from(crowdReports)
    .innerJoin(users, eq(users.id, crowdReports.reporterId))
    .where(and(eq(crowdReports.status, "accepted"), where))
    .groupBy(crowdReports.reporterId, users.name);
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    points: r.points,
    accepted: r.accepted,
    reachedAt: r.reachedAt ?? new Date(0),
  }));
}

/** Leaderboard satu cycle (spec §6). */
export async function cycleLeaderboard(db: Queryable, cycleId: string, meId: string | null): Promise<LeaderboardDto> {
  return rankLeaderboard(await leaderboardRows(db, eq(crowdReports.cycleId, cycleId)), meId, LEADERBOARD_SIZE);
}

/** Leaderboard global: semua cycle non-draft (spec §6). */
export async function globalLeaderboardRows(db: Queryable): Promise<LeaderboardRow[]> {
  return leaderboardRows(
    db,
    sql`exists (select 1 from ${crowdCycles} where ${crowdCycles.id} = ${crowdReports.cycleId} and ${ne(crowdCycles.status, "draft")})`,
  );
}
