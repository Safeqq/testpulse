import { branchDto, createdTokenDto, ingestResultDto, runDetailDto, runsPageDto, statsDto } from "@testpulse/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { runs } from "../../src/db/schema.js";
import { createProject, createTestApp, registerUser } from "./helpers.js";

const XML = `<?xml version="1.0" encoding="UTF-8"?><testsuite name="s"><testcase classname="s" name="a"/></testsuite>`;

describe("versi run (spec Tahap 3 §4.1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  async function setup() {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.slug}/tokens`,
      headers: { cookie: admin.cookie },
      payload: { name: "CI" },
    });
    expect(res.statusCode).toBe(201);
    return { admin, project, token: createdTokenDto.parse(res.json()).token };
  }

  const upload = (slug: string, token: string, query: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/projects/${slug}/runs?${query}`,
      headers: { "content-type": "application/xml", authorization: `Bearer ${token}` },
      payload: XML,
    });

  const get = (url: string, cookie: string) => app.inject({ method: "GET", url: `/api/v1${url}`, headers: { cookie } });

  it("upload dengan version menyimpannya di runs.version dan menampilkannya di semua DTO run", async () => {
    const { admin, project, token } = await setup();
    const res = await upload(project.slug, token, "branch=main&version=1.0.1");
    expect(res.statusCode).toBe(201);
    const { runId } = ingestResultDto.parse(res.json());

    const [row] = await app.db.select({ version: runs.version }).from(runs).where(eq(runs.id, runId));
    expect(row?.version).toBe("1.0.1");

    const list = runsPageDto.parse((await get(`/projects/${project.slug}/runs`, admin.cookie)).json());
    expect(list.runs.map((r) => r.version)).toEqual(["1.0.1"]);

    const detail = runDetailDto.parse((await get(`/projects/${project.slug}/runs/${runId}`, admin.cookie)).json());
    expect(detail.run.version).toBe("1.0.1");

    const branches = (await get(`/projects/${project.slug}/branches`, admin.cookie)).json().map((b: unknown) => branchDto.parse(b));
    expect(branches[0]?.lastRun.version).toBe("1.0.1");

    const stats = statsDto.parse((await get(`/projects/${project.slug}/stats`, admin.cookie)).json());
    expect(stats.latest?.version).toBe("1.0.1");
  });

  it("upload tanpa version: runs.version NULL dan DTO version null", async () => {
    const { admin, project, token } = await setup();
    const { runId } = ingestResultDto.parse((await upload(project.slug, token, "branch=main")).json());
    const [row] = await app.db.select({ version: runs.version }).from(runs).where(eq(runs.id, runId));
    expect(row?.version).toBeNull();
    const detail = runDetailDto.parse((await get(`/projects/${project.slug}/runs/${runId}`, admin.cookie)).json());
    expect(detail.run.version).toBeNull();
  });

  it.each([["1%200"], ["a%2Fb"], [""], ["a".repeat(51)]])("version tidak sah %j -> 400 fields.version, tidak ada run", async (bad) => {
    const { admin, project, token } = await setup();
    const res = await upload(project.slug, token, `branch=main&version=${bad}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields).toHaveProperty("version");
    const list = runsPageDto.parse((await get(`/projects/${project.slug}/runs`, admin.cookie)).json());
    expect(list.runs).toEqual([]);
  });

  it("GET /runs?version= menyaring run, bisa digabung dengan branch dan cursor", async () => {
    const { admin, project, token } = await setup();
    for (const q of [
      "branch=main&version=1.0.0",
      "branch=main&version=1.0.1",
      "branch=dev&version=1.0.1",
      "branch=main",
      "branch=main&version=1.0.1",
    ]) {
      expect((await upload(project.slug, token, q)).statusCode).toBe(201);
    }

    const only = runsPageDto.parse((await get(`/projects/${project.slug}/runs?version=1.0.1`, admin.cookie)).json());
    expect(only.runs).toHaveLength(3);
    expect(only.runs.every((r) => r.version === "1.0.1")).toBe(true);

    const withBranch = runsPageDto.parse(
      (await get(`/projects/${project.slug}/runs?version=1.0.1&branch=main`, admin.cookie)).json(),
    );
    expect(withBranch.runs).toHaveLength(2);
    expect(withBranch.runs.every((r) => r.branch === "main" && r.version === "1.0.1")).toBe(true);

    const none = runsPageDto.parse((await get(`/projects/${project.slug}/runs?version=9.9.9`, admin.cookie)).json());
    expect(none).toEqual({ runs: [], nextCursor: null });
  });

  it("GET /runs?version= tidak sah -> 400 fields.version", async () => {
    const { admin, project } = await setup();
    const res = await get(`/projects/${project.slug}/runs?version=1%200`, admin.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields).toHaveProperty("version");
  });
});
