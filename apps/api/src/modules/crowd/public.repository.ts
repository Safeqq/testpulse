import type {
  CrowdMeDto,
  CrowdReportCountsDto,
  CrowdReportStatus,
  CycleDirectoryItemDto,
  KnownIssueDto,
  LeaderboardEntryDto,
  MeState,
  ParticipantStatus,
  PublicCycleDto,
  TesterProfileDto,
} from "@testpulse/shared";
import { and, count, desc, eq, inArray, ne, or, sql, sum, type AnyColumn, type SQL } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { crowdCycles, crowdParticipants, crowdReports, memberships, projects, users } from "../../db/schema.js";
import { escapeLike } from "../bugs/read.repository.js";
import { activeParticipantsByCycle, contentByCycle, EMPTY_REPORT_COUNTS, effectivelyOpen } from "./cycles.repository.js";
import { canJoin, joinTransition, leaveTransition, participantState, type JoinError } from "./domain/access.js";
import { effectiveCycleStatus } from "./domain/cycles.js";
import { acceptanceRate } from "./domain/reputation.js";

type CycleRow = typeof crowdCycles.$inferSelect;

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const micros = (column: SQL | AnyColumn) => sql`(extract(epoch from ${column}) * 1000000)::bigint`;

/** Batas akhir untuk urutan tab "berlangsung": tanpa `ends_at` diletakkan paling akhir. */
const OPEN_END_KEY = sql<number>`coalesce(${micros(crowdCycles.endsAt)}, 9000000000000000)`;
/** Waktu selesai untuk urutan tab "selesai": `closed_at` bila ditutup, selain itu `ends_at` yang sudah lewat. */
const CLOSED_KEY = sql<number>`${micros(sql`case when ${crowdCycles.status} = 'closed' then ${crowdCycles.closedAt} else ${crowdCycles.endsAt} end`)}`;
const OPENED_KEY = sql<number>`${micros(crowdCycles.openedAt)}`;

export type DirectoryCursor = { status: "open"; end: number; opened: number; id: string } | { status: "closed"; ended: number; id: string };

/** Cycle yang terlihat publik (bukan draft) berdasarkan id; `null` bila tidak ada atau masih draft. */
export async function findPublicCycleRow(db: Queryable, id: string): Promise<CycleRow | null> {
  const [row] = await db.select().from(crowdCycles).where(and(eq(crowdCycles.id, id), ne(crowdCycles.status, "draft")));
  return row ?? null;
}

async function acceptedByCycle(db: Queryable, cycleIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>(cycleIds.map((id) => [id, 0]));
  if (cycleIds.length === 0) return result;
  const rows = await db
    .select({ cycleId: crowdReports.cycleId, n: count() })
    .from(crowdReports)
    .where(and(inArray(crowdReports.cycleId, cycleIds), eq(crowdReports.status, "accepted")))
    .groupBy(crowdReports.cycleId);
  for (const row of rows) result.set(row.cycleId, row.n);
  return result;
}

async function projectRefs(db: Queryable, projectIds: string[]): Promise<Map<string, { name: string; slug: string | null }>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug, visibility: projects.visibility })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  // Slug project privat tidak pernah keluar lewat permukaan publik (spec §3.3).
  return new Map(rows.map((r) => [r.id, { name: r.name, slug: r.visibility === "public" ? r.slug : null }]));
}

export async function listDirectory(
  db: Queryable,
  opts: { status: "open" | "closed"; q?: string; after?: DirectoryCursor; limit: number },
): Promise<(CycleDirectoryItemDto & { cursor: DirectoryCursor })[]> {
  const conditions: (SQL | undefined)[] = [ne(crowdCycles.status, "draft")];
  conditions.push(opts.status === "open" ? effectivelyOpen() : sql`not (${effectivelyOpen()})`);
  if (opts.q !== undefined) {
    const pattern = `%${escapeLike(opts.q)}%`;
    conditions.push(
      or(sql`${crowdCycles.title} ilike ${pattern} escape '\\'`, sql`${crowdCycles.summary} ilike ${pattern} escape '\\'`),
    );
  }
  const after = opts.after;
  if (after?.status === "open") {
    conditions.push(
      sql`(${OPEN_END_KEY} > ${after.end} or (${OPEN_END_KEY} = ${after.end} and (${OPENED_KEY} < ${after.opened} or (${OPENED_KEY} = ${after.opened} and ${crowdCycles.id} > ${after.id}))))`,
    );
  } else if (after?.status === "closed") {
    conditions.push(sql`(${CLOSED_KEY} < ${after.ended} or (${CLOSED_KEY} = ${after.ended} and ${crowdCycles.id} > ${after.id}))`);
  }
  const order =
    opts.status === "open"
      ? [sql`${OPEN_END_KEY} asc`, sql`${OPENED_KEY} desc`, sql`${crowdCycles.id} asc`]
      : [sql`${CLOSED_KEY} desc`, sql`${crowdCycles.id} asc`];

  const rows = await db
    .select({
      row: crowdCycles,
      endKey: OPEN_END_KEY.mapWith(Number),
      openedKey: OPENED_KEY.mapWith(Number),
      closedKey: CLOSED_KEY.mapWith(Number),
    })
    .from(crowdCycles)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit);

  const ids = rows.map((r) => r.row.id);
  const [participants, accepted, refs] = await Promise.all([
    activeParticipantsByCycle(db, ids),
    acceptedByCycle(db, ids),
    projectRefs(db, [...new Set(rows.map((r) => r.row.projectId))]),
  ]);
  const now = new Date();
  return rows.map(({ row, endKey, openedKey, closedKey }) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    project: refs.get(row.projectId)!,
    status: effectiveCycleStatus(row, now),
    endsAt: iso(row.endsAt),
    openedAt: iso(row.openedAt),
    participants: participants.get(row.id)!,
    accepted: accepted.get(row.id)!,
    cursor:
      opts.status === "open"
        ? { status: "open", end: endKey, opened: openedKey, id: row.id }
        : { status: "closed", ended: closedKey, id: row.id },
  }));
}

export interface Visitor {
  isMember: boolean;
  participantStatus: ParticipantStatus | null;
}

/** Keanggotaan project dan status peserta pengguna di cycle; anonim = bukan anggota, bukan peserta. */
export async function visitorOf(db: Queryable, cycle: CycleRow, userId: string | null): Promise<Visitor> {
  if (userId === null) return { isMember: false, participantStatus: null };
  const [member] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.projectId, cycle.projectId), eq(memberships.userId, userId)));
  const [participant] = await db
    .select({ status: crowdParticipants.status })
    .from(crowdParticipants)
    .where(and(eq(crowdParticipants.cycleId, cycle.id), eq(crowdParticipants.userId, userId)));
  return { isMember: member !== undefined, participantStatus: participant?.status ?? null };
}

export function meOf(cycle: CycleRow, authenticated: boolean, visitor: Visitor, now: Date): { state: MeState; participantStatus: ParticipantStatus | null } {
  return {
    state: participantState({ authenticated, ...visitor, effectiveStatus: effectiveCycleStatus(cycle, now) }),
    participantStatus: visitor.participantStatus,
  };
}

export async function loadPublicCycleDto(db: Queryable, cycle: CycleRow, userId: string | null, now: Date): Promise<PublicCycleDto> {
  const [content, participants, accepted, refs, visitor] = await Promise.all([
    contentByCycle(db, [cycle.id]),
    activeParticipantsByCycle(db, [cycle.id]),
    acceptedByCycle(db, [cycle.id]),
    projectRefs(db, [cycle.projectId]),
    visitorOf(db, cycle, userId),
  ]);
  return {
    id: cycle.id,
    title: cycle.title,
    summary: cycle.summary,
    links: content.get(cycle.id)!.links,
    instructions: cycle.instructions,
    inScope: cycle.inScope,
    outOfScope: cycle.outOfScope,
    environments: content.get(cycle.id)!.environments,
    appVersion: cycle.appVersion,
    endsAt: iso(cycle.endsAt),
    status: effectiveCycleStatus(cycle, now),
    openedAt: iso(cycle.openedAt),
    project: refs.get(cycle.projectId)!,
    stats: { participants: participants.get(cycle.id)!, accepted: accepted.get(cycle.id)! },
    me: meOf(cycle, userId !== null, visitor, now),
  };
}

/**
 * Bergabung ke cycle (spec §4). Satu transaksi: baris cycle `FOR SHARE` (status dibaca terkunci terhadap penutupan),
 * lalu upsert peserta yang tidak pernah menghidupkan kembali status `removed` (kondisi `where` pada `on conflict`
 * melindungi dari balapan dengan tombol keluarkan).
 */
export async function joinCycle(
  db: Db,
  input: { cycleId: string; userId: string; now: Date },
): Promise<{ state: MeState; participantStatus: ParticipantStatus | null } | JoinError | "not_found"> {
  return db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(crowdCycles)
      .where(and(eq(crowdCycles.id, input.cycleId), ne(crowdCycles.status, "draft")))
      .for("share");
    if (!cycle) return "not_found" as const;
    const visitor = await visitorOf(tx, cycle, input.userId);
    const error = canJoin({ authenticated: true, ...visitor, effectiveStatus: effectiveCycleStatus(cycle, input.now) });
    if (error) return error;
    if (joinTransition(visitor.participantStatus) === null) return "PARTICIPANT_REMOVED" as const;

    const upserted = await tx
      .insert(crowdParticipants)
      .values({ cycleId: cycle.id, userId: input.userId, status: "active" })
      .onConflictDoUpdate({
        target: [crowdParticipants.cycleId, crowdParticipants.userId],
        set: { status: "active", rulesAcceptedAt: sql`statement_timestamp()`, leftAt: null },
        setWhere: ne(crowdParticipants.status, "removed"),
      })
      .returning({ status: crowdParticipants.status });
    if (upserted.length === 0) return "PARTICIPANT_REMOVED" as const;
    return meOf(cycle, true, { isMember: false, participantStatus: "active" }, input.now);
  });
}

/** Keluar dari cycle; peserta yang dikeluarkan tetap `removed` (Review Focus 2). */
export async function leaveCycle(db: Db, input: { cycleId: string; userId: string }): Promise<"ok" | "not_participant" | "not_found"> {
  return db.transaction(async (tx) => {
    const [cycle] = await tx
      .select({ id: crowdCycles.id })
      .from(crowdCycles)
      .where(and(eq(crowdCycles.id, input.cycleId), ne(crowdCycles.status, "draft")));
    if (!cycle) return "not_found" as const;
    const [participant] = await tx
      .select({ status: crowdParticipants.status })
      .from(crowdParticipants)
      .where(and(eq(crowdParticipants.cycleId, cycle.id), eq(crowdParticipants.userId, input.userId)))
      .for("update");
    if (!participant) return "not_participant" as const;
    const next = leaveTransition(participant.status);
    if (next !== null) {
      await tx
        .update(crowdParticipants)
        .set({ status: next, leftAt: sql`statement_timestamp()` })
        .where(and(eq(crowdParticipants.cycleId, cycle.id), eq(crowdParticipants.userId, input.userId)));
    }
    return "ok" as const;
  });
}

const triagedMicros = sql<number>`${micros(sql`${crowdReports.triagedAt}`)}`;

export async function listKnownIssues(
  db: Queryable,
  opts: { cycleId: string; after?: { at: number; id: string }; limit: number },
): Promise<(KnownIssueDto & { cursor: { at: number; id: string } })[]> {
  const conditions: (SQL | undefined)[] = [
    eq(crowdReports.cycleId, opts.cycleId),
    eq(crowdReports.status, "accepted"),
    eq(crowdReports.hideFromKnownIssues, false),
  ];
  if (opts.after) {
    conditions.push(
      sql`(${triagedMicros} < ${opts.after.at} or (${triagedMicros} = ${opts.after.at} and ${crowdReports.id} > ${opts.after.id}))`,
    );
  }
  const rows = await db
    .select({
      id: crowdReports.id,
      title: crowdReports.title,
      severity: crowdReports.finalSeverity,
      triagedAt: crowdReports.triagedAt,
      at: triagedMicros.mapWith(Number),
    })
    .from(crowdReports)
    .where(and(...conditions))
    .orderBy(sql`${triagedMicros} desc`, sql`${crowdReports.id} asc`)
    .limit(opts.limit);
  return rows.map((r) => ({
    title: r.title,
    severity: r.severity ?? "minor",
    acceptedAt: r.triagedAt!.toISOString(),
    cursor: { at: r.at, id: r.id },
  }));
}

/** Laporan di cycle non-draft milik pengguna, dikelompokkan per status. */
async function decisionCounts(db: Queryable, userId: string): Promise<{ accepted: number; rejected: number; duplicate: number }> {
  const rows = await db
    .select({ status: crowdReports.status, n: count() })
    .from(crowdReports)
    .innerJoin(crowdCycles, eq(crowdCycles.id, crowdReports.cycleId))
    .where(and(eq(crowdReports.reporterId, userId), ne(crowdCycles.status, "draft")))
    .groupBy(crowdReports.status);
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return { accepted: by.get("accepted") ?? 0, rejected: by.get("rejected") ?? 0, duplicate: by.get("duplicate") ?? 0 };
}

async function totalPoints(db: Queryable, userId: string): Promise<number> {
  const [row] = await db
    .select({ points: sum(crowdReports.points).mapWith(Number) })
    .from(crowdReports)
    .innerJoin(crowdCycles, eq(crowdCycles.id, crowdReports.cycleId))
    .where(and(eq(crowdReports.reporterId, userId), eq(crowdReports.status, "accepted"), ne(crowdCycles.status, "draft")));
  return row?.points ?? 0;
}

export async function testerProfile(db: Queryable, userId: string): Promise<TesterProfileDto | null> {
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  const [counts, points, cycles, recent] = await Promise.all([
    decisionCounts(db, userId),
    totalPoints(db, userId),
    db
      .select({ n: count() })
      .from(crowdParticipants)
      .innerJoin(crowdCycles, eq(crowdCycles.id, crowdParticipants.cycleId))
      .where(and(eq(crowdParticipants.userId, userId), ne(crowdCycles.status, "draft"))),
    db
      .select({
        title: crowdReports.title,
        severity: crowdReports.finalSeverity,
        cycleId: crowdCycles.id,
        cycleTitle: crowdCycles.title,
        triagedAt: crowdReports.triagedAt,
      })
      .from(crowdReports)
      .innerJoin(crowdCycles, eq(crowdCycles.id, crowdReports.cycleId))
      .where(
        and(
          eq(crowdReports.reporterId, userId),
          eq(crowdReports.status, "accepted"),
          eq(crowdReports.hideFromKnownIssues, false),
          ne(crowdCycles.status, "draft"),
        ),
      )
      .orderBy(desc(crowdReports.triagedAt), desc(crowdReports.number))
      .limit(10),
  ]);
  return {
    user,
    points,
    acceptanceRate: acceptanceRate(counts),
    cycles: cycles[0]?.n ?? 0,
    recentAccepted: recent.map((r) => ({
      title: r.title,
      severity: r.severity ?? "minor",
      cycle: { id: r.cycleId, title: r.cycleTitle },
      acceptedAt: r.triagedAt!.toISOString(),
    })),
  };
}

export async function crowdMe(db: Queryable, userId: string, now: Date): Promise<CrowdMeDto> {
  const cycles = await db
    .select({ cycle: crowdCycles, status: crowdParticipants.status })
    .from(crowdParticipants)
    .innerJoin(crowdCycles, eq(crowdCycles.id, crowdParticipants.cycleId))
    .where(and(eq(crowdParticipants.userId, userId), ne(crowdCycles.status, "draft")))
    .orderBy(desc(crowdParticipants.joinedAt));
  const ids = cycles.map((c) => c.cycle.id);
  const counts = new Map<string, CrowdReportCountsDto>(ids.map((id) => [id, { ...EMPTY_REPORT_COUNTS }]));
  const points = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length > 0) {
    const rows = await db
      .select({
        cycleId: crowdReports.cycleId,
        status: crowdReports.status,
        n: count(),
        points: sum(crowdReports.points).mapWith(Number),
      })
      .from(crowdReports)
      .where(and(eq(crowdReports.reporterId, userId), inArray(crowdReports.cycleId, ids)))
      .groupBy(crowdReports.cycleId, crowdReports.status);
    for (const row of rows) {
      counts.get(row.cycleId)![row.status as CrowdReportStatus] = row.n;
      if (row.status === "accepted") points.set(row.cycleId, row.points);
    }
  }
  const [decisions, total] = await Promise.all([decisionCounts(db, userId), totalPoints(db, userId)]);
  return {
    cycles: cycles.map(({ cycle, status }) => ({
      cycle: { id: cycle.id, title: cycle.title, status: effectiveCycleStatus(cycle, now) },
      status,
      reportCounts: counts.get(cycle.id)!,
      points: points.get(cycle.id)!,
    })),
    points: total,
    acceptanceRate: acceptanceRate(decisions),
  };
}

/** Entri leaderboard global pengguna `meId` dihitung segar (rank asli di antara semua tester), atau `null`. */
export async function globalMeEntry(db: Queryable, meId: string): Promise<LeaderboardEntryDto | null> {
  const result = await db.execute<{ points: string; accepted: string; reached: string; name: string; rank: string }>(sql`
    with totals as (
      select r.reporter_id, sum(r.points) as points, count(*) as accepted, max(r.triaged_at) as reached
        from ${crowdReports} r
        join ${crowdCycles} c on c.id = r.cycle_id and c.status <> 'draft'
       where r.status = 'accepted'
       group by r.reporter_id
    ), me as (select * from totals where reporter_id = ${meId})
    select me.points, me.accepted, me.reached, u.name,
           1 + (select count(*) from totals t
                 where t.points > 0 and (t.points > me.points
                    or (t.points = me.points and t.accepted > me.accepted)
                    or (t.points = me.points and t.accepted = me.accepted and t.reached < me.reached)
                    or (t.points = me.points and t.accepted = me.accepted and t.reached = me.reached and t.reporter_id < me.reporter_id))) as rank
      from me join ${users} u on u.id = me.reporter_id
     where me.points > 0`);
  const row = result.rows[0];
  if (!row) return null;
  return { rank: Number(row.rank), user: { id: meId, name: row.name }, points: Number(row.points), accepted: Number(row.accepted) };
}
