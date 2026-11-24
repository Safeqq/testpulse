import type {
  CreateCycleBody,
  CrowdReportCountsDto,
  CrowdReportStatus,
  CycleStatus,
  TeamCycleDto,
  UpdateCycleBody,
} from "@testpulse/shared";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Db, Queryable } from "../../db/client.js";
import {
  crowdCycleEnvironments,
  crowdCycleLinks,
  crowdCycles,
  crowdParticipants,
  crowdReports,
  projects,
} from "../../db/schema.js";
import { cycleTransition, effectiveCycleStatus } from "./domain/cycles.js";

/*
 * Urutan kunci crowdtesting (spec Tahap 5 §7): project → cycle → peserta → laporan.
 * - Buat cycle: project (`FOR NO KEY UPDATE`) menyerialkan penomoran `cycle_seq`.
 * - Ubah / hapus cycle: baris cycle (`FOR UPDATE`). Pengiriman laporan memegang cycle `FOR SHARE`, jadi penutupan
 *   cycle menunggu pengiriman yang sedang berjalan dan pengiriman berikutnya melihat status baru.
 */

type CycleRow = typeof crowdCycles.$inferSelect;
type CycleChanges = PgUpdateSetSource<typeof crowdCycles>;

export const EMPTY_REPORT_COUNTS: CrowdReportCountsDto = { submitted: 0, accepted: 0, rejected: 0, duplicate: 0, withdrawn: 0 };

/** Kondisi SQL "status efektif open" (open dan belum lewat `ends_at`). */
export const effectivelyOpen = (): SQL =>
  and(eq(crowdCycles.status, "open"), or(isNull(crowdCycles.endsAt), gt(crowdCycles.endsAt, sql`now()`)))!;

export async function findCycleRow(db: Queryable, projectId: string, number: number): Promise<CycleRow | null> {
  const [row] = await db
    .select()
    .from(crowdCycles)
    .where(and(eq(crowdCycles.projectId, projectId), eq(crowdCycles.number, number)));
  return row ?? null;
}

/** Hitungan laporan per status per cycle, satu query untuk semua cycle. */
export async function reportCountsByCycle(db: Queryable, cycleIds: string[]): Promise<Map<string, CrowdReportCountsDto>> {
  const result = new Map<string, CrowdReportCountsDto>(cycleIds.map((id) => [id, { ...EMPTY_REPORT_COUNTS }]));
  if (cycleIds.length === 0) return result;
  const rows = await db
    .select({ cycleId: crowdReports.cycleId, status: crowdReports.status, n: count() })
    .from(crowdReports)
    .where(inArray(crowdReports.cycleId, cycleIds))
    .groupBy(crowdReports.cycleId, crowdReports.status);
  for (const row of rows) result.get(row.cycleId)![row.status as CrowdReportStatus] = row.n;
  return result;
}

/** Jumlah peserta aktif per cycle. */
export async function activeParticipantsByCycle(db: Queryable, cycleIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>(cycleIds.map((id) => [id, 0]));
  if (cycleIds.length === 0) return result;
  const rows = await db
    .select({ cycleId: crowdParticipants.cycleId, n: count() })
    .from(crowdParticipants)
    .where(and(inArray(crowdParticipants.cycleId, cycleIds), eq(crowdParticipants.status, "active")))
    .groupBy(crowdParticipants.cycleId);
  for (const row of rows) result.set(row.cycleId, row.n);
  return result;
}

export interface CycleContent {
  links: { url: string; label: string }[];
  environments: string[];
}

/** Link (urut posisi) dan lingkungan (urut posisi) untuk sekumpulan cycle. */
export async function contentByCycle(db: Queryable, cycleIds: string[]): Promise<Map<string, CycleContent>> {
  const result = new Map<string, CycleContent>(cycleIds.map((id) => [id, { links: [], environments: [] }]));
  if (cycleIds.length === 0) return result;
  const links = await db
    .select({ cycleId: crowdCycleLinks.cycleId, url: crowdCycleLinks.url, label: crowdCycleLinks.label })
    .from(crowdCycleLinks)
    .where(inArray(crowdCycleLinks.cycleId, cycleIds))
    .orderBy(asc(crowdCycleLinks.cycleId), asc(crowdCycleLinks.position));
  for (const link of links) result.get(link.cycleId)!.links.push({ url: link.url, label: link.label });
  const envs = await db
    .select({ cycleId: crowdCycleEnvironments.cycleId, label: crowdCycleEnvironments.label })
    .from(crowdCycleEnvironments)
    .where(inArray(crowdCycleEnvironments.cycleId, cycleIds))
    .orderBy(asc(crowdCycleEnvironments.cycleId), asc(crowdCycleEnvironments.position));
  for (const env of envs) result.get(env.cycleId)!.environments.push(env.label);
  return result;
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

async function toTeamCycleDtos(db: Queryable, rows: CycleRow[], now: Date): Promise<TeamCycleDto[]> {
  const ids = rows.map((r) => r.id);
  const [content, counts, participants] = await Promise.all([
    contentByCycle(db, ids),
    reportCountsByCycle(db, ids),
    activeParticipantsByCycle(db, ids),
  ]);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    summary: row.summary,
    links: content.get(row.id)!.links,
    instructions: row.instructions,
    inScope: row.inScope,
    outOfScope: row.outOfScope,
    environments: content.get(row.id)!.environments,
    appVersion: row.appVersion,
    endsAt: iso(row.endsAt),
    status: row.status,
    effectiveStatus: effectiveCycleStatus(row, now),
    openedAt: iso(row.openedAt),
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    participants: participants.get(row.id)!,
    reportCounts: counts.get(row.id)!,
  }));
}

export async function loadTeamCycleDto(db: Queryable, cycleId: string, now: Date): Promise<TeamCycleDto> {
  const rows = await db.select().from(crowdCycles).where(eq(crowdCycles.id, cycleId));
  return (await toTeamCycleDtos(db, rows, now))[0]!;
}

export async function findTeamCycle(
  db: Queryable,
  opts: { projectId: string; number: number; includeDraft: boolean; now: Date },
): Promise<TeamCycleDto | null> {
  const row = await findCycleRow(db, opts.projectId, opts.number);
  if (!row || (row.status === "draft" && !opts.includeDraft)) return null;
  return (await toTeamCycleDtos(db, [row], opts.now))[0]!;
}

export async function listTeamCycles(
  db: Queryable,
  opts: { projectId: string; includeDrafts: boolean; status?: CycleStatus; after?: number; limit: number; now: Date },
): Promise<TeamCycleDto[]> {
  const conditions: (SQL | undefined)[] = [eq(crowdCycles.projectId, opts.projectId)];
  if (!opts.includeDrafts) conditions.push(ne(crowdCycles.status, "draft"));
  if (opts.status !== undefined) conditions.push(eq(crowdCycles.status, opts.status));
  if (opts.after !== undefined) conditions.push(lt(crowdCycles.number, opts.after));
  const rows = await db
    .select()
    .from(crowdCycles)
    .where(and(...conditions))
    .orderBy(desc(crowdCycles.number))
    .limit(opts.limit);
  return toTeamCycleDtos(db, rows, opts.now);
}

async function writeContent(
  tx: Queryable,
  cycleId: string,
  content: { links?: { url: string; label: string }[]; environments?: string[] },
): Promise<void> {
  if (content.links !== undefined) {
    await tx.delete(crowdCycleLinks).where(eq(crowdCycleLinks.cycleId, cycleId));
    if (content.links.length > 0) {
      await tx.insert(crowdCycleLinks).values(content.links.map((l, position) => ({ cycleId, position, ...l })));
    }
  }
  if (content.environments !== undefined) {
    await tx.delete(crowdCycleEnvironments).where(eq(crowdCycleEnvironments.cycleId, cycleId));
    if (content.environments.length > 0) {
      await tx
        .insert(crowdCycleEnvironments)
        .values(content.environments.map((label, position) => ({ cycleId, position, label })));
    }
  }
}

const inFuture = (iso: string, now: Date) => new Date(iso).getTime() > now.getTime();

export type CycleFailure = "not_found" | "conflict" | "invalid_transition" | { field: "endsAt" };

export async function createCycle(
  db: Db,
  input: { projectId: string; actorId: string; body: CreateCycleBody; now: Date },
): Promise<TeamCycleDto | "project_not_found" | { field: "endsAt" }> {
  const { projectId, actorId, body, now } = input;
  if (body.endsAt != null && !inFuture(body.endsAt, now)) return { field: "endsAt" };
  return db.transaction(async (tx) => {
    const [seq] = await tx
      .update(projects)
      .set({ cycleSeq: sql`${projects.cycleSeq} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ n: projects.cycleSeq });
    if (!seq) return "project_not_found" as const;
    const [row] = await tx
      .insert(crowdCycles)
      .values({
        projectId,
        number: seq.n,
        title: body.title,
        summary: body.summary ?? "",
        instructions: body.instructions ?? "",
        inScope: body.inScope ?? "",
        outOfScope: body.outOfScope ?? "",
        appVersion: body.appVersion ?? null,
        endsAt: body.endsAt == null ? null : new Date(body.endsAt),
        createdBy: actorId,
      })
      .returning({ id: crowdCycles.id });
    await writeContent(tx, row!.id, { links: body.links, environments: body.environments ?? [] });
    return loadTeamCycleDto(tx, row!.id, now);
  });
}

export async function updateCycle(
  db: Db,
  input: { projectId: string; number: number; body: UpdateCycleBody; now: Date },
): Promise<TeamCycleDto | CycleFailure> {
  const { projectId, number, body, now } = input;
  return db.transaction(async (tx): Promise<TeamCycleDto | CycleFailure> => {
    const [row] = await tx
      .select()
      .from(crowdCycles)
      .where(and(eq(crowdCycles.projectId, projectId), eq(crowdCycles.number, number)))
      .for("update");
    if (!row) return "not_found";
    if (row.version !== body.version) return "conflict";

    // Spec §3.1: endsAt harus di masa depan saat diisi atau diubah; nilai yang sama dengan yang tersimpan bukan perubahan,
    // jadi isi cycle yang sudah lewat endsAt tetap bisa diedit (spec §3.2).
    const endsAtUnchanged = body.endsAt != null && row.endsAt !== null && Date.parse(body.endsAt) === row.endsAt.getTime();
    if (body.endsAt != null && !endsAtUnchanged && !inFuture(body.endsAt, now)) return { field: "endsAt" };
    const endsAt = body.endsAt === undefined ? row.endsAt : body.endsAt === null ? null : new Date(body.endsAt);

    const changes: CycleChanges = {};
    if (body.status !== undefined) {
      const transition = cycleTransition(row.status, body.status, { endsAt, now });
      if (transition === "invalid") return "invalid_transition";
      if (transition === "ends_at_passed") return { field: "endsAt" };
      if (transition === "ok") {
        changes.status = body.status;
        if (body.status === "open" && row.openedAt === null) changes.openedAt = sql`statement_timestamp()`;
        if (body.status === "closed") changes.closedAt = sql`statement_timestamp()`;
        if (body.status === "open") changes.closedAt = null;
      }
    }
    if (body.title !== undefined) changes.title = body.title;
    if (body.summary !== undefined) changes.summary = body.summary;
    if (body.instructions !== undefined) changes.instructions = body.instructions;
    if (body.inScope !== undefined) changes.inScope = body.inScope;
    if (body.outOfScope !== undefined) changes.outOfScope = body.outOfScope;
    if (body.appVersion !== undefined) changes.appVersion = body.appVersion;
    if (body.endsAt !== undefined) changes.endsAt = endsAt;

    await writeContent(tx, row.id, {
      ...(body.links !== undefined ? { links: body.links } : {}),
      ...(body.environments !== undefined ? { environments: body.environments } : {}),
    });
    await tx
      .update(crowdCycles)
      .set({ ...changes, version: sql`${crowdCycles.version} + 1`, updatedAt: sql`statement_timestamp()` })
      .where(eq(crowdCycles.id, row.id));
    return loadTeamCycleDto(tx, row.id, now);
  });
}

/** Hapus cycle tanpa laporan (spec §3.2); cycle yang sudah dipakai cukup ditutup agar poin tester tidak hilang. */
export async function deleteCycle(db: Db, projectId: string, number: number): Promise<"ok" | "not_found" | "has_reports"> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: crowdCycles.id })
      .from(crowdCycles)
      .where(and(eq(crowdCycles.projectId, projectId), eq(crowdCycles.number, number)))
      .for("update");
    if (!row) return "not_found" as const;
    const [report] = await tx.select({ id: crowdReports.id }).from(crowdReports).where(eq(crowdReports.cycleId, row.id)).limit(1);
    if (report) return "has_reports" as const;
    await tx.delete(crowdCycles).where(eq(crowdCycles.id, row.id));
    return "ok" as const;
  });
}

/** Ringkasan kartu dashboard (spec §9.4); `null` bila project belum punya cycle. */
export async function crowdSummary(
  db: Queryable,
  projectId: string,
): Promise<{ openCycles: number; awaitingTriage: number; accepted30d: number } | null> {
  const [cycles] = await db
    .select({
      total: count(),
      open: sql<number>`count(*) filter (where ${effectivelyOpen()})`.mapWith(Number),
    })
    .from(crowdCycles)
    .where(eq(crowdCycles.projectId, projectId));
  if (!cycles || cycles.total === 0) return null;
  const [reports] = await db
    .select({
      awaiting: sql<number>`count(*) filter (where ${crowdReports.status} = 'submitted')`.mapWith(Number),
      accepted: sql<number>`count(*) filter (where ${crowdReports.status} = 'accepted' and ${crowdReports.triagedAt} >= now() - interval '30 days')`.mapWith(
        Number,
      ),
    })
    .from(crowdReports)
    .where(eq(crowdReports.projectId, projectId));
  return { openCycles: cycles.open, awaitingTriage: reports?.awaiting ?? 0, accepted30d: reports?.accepted ?? 0 };
}
