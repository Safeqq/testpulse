import { faker } from "@faker-js/faker";
import { teamCycleDto, type CrowdReportStatus, type CrowdSeverity, type ProjectDto, type TeamCycleDto } from "@testpulse/shared";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { crowdParticipants, crowdReports, projects } from "../../src/db/schema.js";
import { addMember, createProject, registerUser, type RegisteredUser } from "./helpers.js";

/** Fixture tim crowdtesting: admin pemilik, tester, viewer, dan satu project (privat kecuali diminta publik). */
export interface CrowdFixture {
  admin: RegisteredUser;
  tester: RegisteredUser;
  viewer: RegisteredUser;
  project: ProjectDto;
}

export async function setupCrowdProject(
  app: FastifyInstance,
  opts: { visibility?: "public" | "private" } = {},
): Promise<CrowdFixture> {
  const admin = await registerUser(app);
  const project = await createProject(app, admin.cookie);
  const tester = await registerUser(app);
  const viewer = await registerUser(app);
  await addMember(app, project.id, tester.user.id, "tester");
  await addMember(app, project.id, viewer.user.id, "viewer");
  if (opts.visibility === "public") {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.slug}`,
      headers: { cookie: admin.cookie },
      payload: { visibility: "public" },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  return { admin, tester, viewer, project };
}

export function teamRequest(
  app: FastifyInstance,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  fx: CrowdFixture,
  path: string,
  cookie?: string | null,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: `/api/v1/projects/${fx.project.slug}${path}`,
    headers: cookie ? { cookie } : {},
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

export function expectError(res: LightMyRequestResponse, status: number, code: string, field?: string): void {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code, res.body).toBe(code);
  if (field !== undefined) expect(Object.keys(res.json().error.fields ?? {}), res.body).toContain(field);
}

export const cycleBody = (over: Record<string, unknown> = {}) => ({
  title: `Uji ${faker.string.alphanumeric(8)}`,
  links: [{ url: "https://app.example.com", label: "Web" }],
  ...over,
});

/** Membuat cycle lewat API (admin) dan, bila diminta, membukanya. */
export async function createCycle(
  app: FastifyInstance,
  fx: CrowdFixture,
  opts: { open?: boolean; body?: Record<string, unknown> } = {},
): Promise<TeamCycleDto> {
  const res = await teamRequest(app, "POST", fx, "/cycles", fx.admin.cookie, cycleBody(opts.body));
  expect(res.statusCode, res.body).toBe(201);
  let cycle = teamCycleDto.parse(res.json());
  if (opts.open) {
    const opened = await teamRequest(app, "PATCH", fx, `/cycles/${cycle.number}`, fx.admin.cookie, {
      version: cycle.version,
      status: "open",
    });
    expect(opened.statusCode, opened.body).toBe(200);
    cycle = teamCycleDto.parse(opened.json());
  }
  return cycle;
}

/** Menyisipkan peserta langsung ke DB (menyiapkan data tanpa endpoint publik). */
export async function insertParticipant(
  app: FastifyInstance,
  cycleId: string,
  userId: string,
  status: "active" | "left" | "removed" = "active",
): Promise<void> {
  await app.db.insert(crowdParticipants).values({ cycleId, userId, status });
}

/** Menyisipkan laporan langsung ke DB dengan nomor CR berikutnya; nilai triase opsional. */
export async function insertReport(
  app: FastifyInstance,
  input: {
    projectId: string;
    cycleId: string;
    reporterId: string;
    status?: CrowdReportStatus;
    severity?: CrowdSeverity;
    points?: number;
    title?: string;
    submittedAt?: Date;
    triagedAt?: Date;
    hide?: boolean;
  },
): Promise<{ id: string; number: number }> {
  const [seq] = await app.db
    .update(projects)
    .set({ crowdReportSeq: sql`${projects.crowdReportSeq} + 1` })
    .where(sql`${projects.id} = ${input.projectId}`)
    .returning({ n: projects.crowdReportSeq });
  const status = input.status ?? "submitted";
  const [row] = await app.db
    .insert(crowdReports)
    .values({
      projectId: input.projectId,
      cycleId: input.cycleId,
      number: seq!.n,
      reporterId: input.reporterId,
      title: input.title ?? `Laporan ${faker.string.alphanumeric(6)}`,
      steps: "Langkah reproduksi yang cukup panjang",
      expected: "Hasil yang diharapkan",
      actual: "Hasil yang terjadi",
      environment: "Chrome 130",
      suggestedSeverity: input.severity ?? "major",
      status,
      finalSeverity: status === "accepted" ? (input.severity ?? "major") : null,
      points: input.points ?? 0,
      hideFromKnownIssues: input.hide ?? false,
      ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
      ...(input.triagedAt || status !== "submitted" ? { triagedAt: input.triagedAt ?? new Date() } : {}),
    })
    .returning({ id: crowdReports.id, number: crowdReports.number });
  return row!;
}

/** Tidak ada alamat email di body respons (spec §6 privasi). */
export function expectNoEmail(res: LightMyRequestResponse): void {
  expect(res.body).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
}
