import type { CrowdReportStatus, HideBody, TeamCrowdReportDto, TriageBody } from "@testpulse/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Db } from "../../db/client.js";
import { bugs, crowdCycles, crowdReportEvents, crowdReportLinks, crowdReports, projects, users } from "../../db/schema.js";
import { insertBug } from "../bugs/write.repository.js";
import { buildCrowdBugDescription } from "./domain/bug-description.js";
import { duplicateTargetError, reportTransition } from "./domain/reports.js";
import { pointsFor } from "./domain/reputation.js";
import { findReportByNumber, loadTeamCrowdReportDto } from "./reports.repository.js";

/*
 * Triase (spec Tahap 5 §5.3). Urutan kunci: project (`FOR NO KEY UPDATE`; juga dipakai `insertBug` untuk nomor bug) →
 * laporan (`FOR UPDATE`). `version` diperiksa setelah laporan terkunci, jadi dua penerimaan bersamaan menghasilkan satu
 * bug dan satu `conflict`.
 */

type ReportChanges = PgUpdateSetSource<typeof crowdReports>;

export type TriageFailure = "not_found" | "conflict" | "invalid" | { field: "duplicateOf" } | "bug_failed";

export async function triageReport(
  db: Db,
  input: { projectId: string; number: number; actorId: string; body: TriageBody },
): Promise<TeamCrowdReportDto | TriageFailure> {
  const { projectId, number, actorId, body } = input;
  return db.transaction(async (tx): Promise<TeamCrowdReportDto | TriageFailure> => {
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("no key update");
    const [report] = await tx
      .select()
      .from(crowdReports)
      .where(and(eq(crowdReports.projectId, projectId), eq(crowdReports.number, number)))
      .for("update");
    if (!report) return "not_found";
    if (report.version !== body.version) return "conflict";
    const next = reportTransition(report.status, body.decision);
    if (next === null) return "invalid";

    const changes: ReportChanges = { status: next as CrowdReportStatus };
    let detail: string | null = null;

    switch (body.decision) {
      case "accept": {
        const severity = body.severity ?? report.suggestedSeverity;
        const [cycle] = await tx
          .select({ number: crowdCycles.number, title: crowdCycles.title })
          .from(crowdCycles)
          .where(eq(crowdCycles.id, report.cycleId));
        const [reporter] = await tx.select({ name: users.name }).from(users).where(eq(users.id, report.reporterId));
        const links = await tx
          .select({ url: crowdReportLinks.url })
          .from(crowdReportLinks)
          .where(eq(crowdReportLinks.reportId, report.id))
          .orderBy(asc(crowdReportLinks.position));
        const bug = await insertBug(tx, {
          projectId,
          reporterId: actorId,
          crowdReportId: report.id,
          body: {
            title: report.title,
            description: buildCrowdBugDescription({
              reportNumber: report.number,
              cycleNumber: cycle!.number,
              cycleTitle: cycle!.title,
              reporterName: reporter!.name,
              environment: report.environment,
              steps: report.steps,
              expected: report.expected,
              actual: report.actual,
              links: links.map((l) => l.url),
            }),
            severity,
            priority: body.priority ?? "medium",
            labels: ["crowd"],
          },
        });
        if (typeof bug === "string") return "bug_failed";
        // `BugDto` tidak memuat id; bug ini satu-satunya yang menaut ke laporan (baru dibuat di transaksi ini).
        const [bugRow] = await tx.select({ id: bugs.id }).from(bugs).where(eq(bugs.crowdReportId, report.id));
        Object.assign(changes, { finalSeverity: severity, points: pointsFor(severity), bugId: bugRow!.id });
        detail = severity;
        break;
      }
      case "reject":
        Object.assign(changes, { rejectReason: body.reason, triageNote: body.note ? body.note : null });
        detail = body.reason;
        break;
      case "duplicate": {
        const target = await findReportByNumber(tx, projectId, body.duplicateOf);
        if (!target || duplicateTargetError(report, target) !== null) return { field: "duplicateOf" };
        changes.duplicateOfId = target.id;
        detail = `CR-${target.number}`;
        break;
      }
      case "reopen":
        Object.assign(changes, { rejectReason: null, triageNote: null, duplicateOfId: null, triagedBy: null, triagedAt: null });
        break;
    }
    if (body.decision !== "reopen") {
      changes.triagedBy = actorId;
      changes.triagedAt = sql`statement_timestamp()`;
    }

    await tx
      .update(crowdReports)
      .set({ ...changes, version: sql`${crowdReports.version} + 1`, updatedAt: sql`statement_timestamp()` })
      .where(eq(crowdReports.id, report.id));
    await tx.insert(crowdReportEvents).values({ reportId: report.id, actorId, fromStatus: report.status, toStatus: next, detail });
    return loadTeamCrowdReportDto(tx, report.id);
  });
}

/** Menyembunyikan laporan diterima dari "Masalah yang sudah diketahui" (spec §5.3). */
export async function setHidden(
  db: Db,
  input: { projectId: string; number: number; body: HideBody },
): Promise<TeamCrowdReportDto | "not_found" | "conflict" | "invalid"> {
  return db.transaction(async (tx) => {
    const report = await findReportByNumber(tx, input.projectId, input.number);
    if (!report) return "not_found" as const;
    const [locked] = await tx.select().from(crowdReports).where(eq(crowdReports.id, report.id)).for("update");
    if (!locked) return "not_found" as const;
    if (locked.version !== input.body.version) return "conflict" as const;
    if (locked.status !== "accepted") return "invalid" as const;
    await tx
      .update(crowdReports)
      .set({
        hideFromKnownIssues: input.body.hideFromKnownIssues,
        version: sql`${crowdReports.version} + 1`,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(eq(crowdReports.id, locked.id));
    return loadTeamCrowdReportDto(tx, locked.id);
  });
}
