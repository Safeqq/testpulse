import { createdTokenDto, tokenDto } from "@testpulse/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { projectTokens } from "../../src/db/schema.js";
import { hashToken } from "../../src/modules/auth/domain/tokens.js";
import { authenticateIngestToken, touchToken } from "../../src/modules/tokens/auth.js";
import { addMember, createProject, createTestApp, registerUser } from "./helpers.js";

const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";

describe("CI tokens", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  async function setup() {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    return { admin, project };
  }

  const create = (slug: string, cookie: string | undefined, name: unknown = "CI utama") =>
    app.inject({
      method: "POST",
      url: `/api/v1/projects/${slug}/tokens`,
      headers: cookie ? { cookie } : {},
      payload: { name },
    });
  const list = (slug: string, cookie?: string) =>
    app.inject({ method: "GET", url: `/api/v1/projects/${slug}/tokens`, headers: cookie ? { cookie } : {} });
  const revoke = (slug: string, id: string, cookie?: string) =>
    app.inject({ method: "DELETE", url: `/api/v1/projects/${slug}/tokens/${id}`, headers: cookie ? { cookie } : {} });

  async function createToken(slug: string, cookie: string, name = "CI utama") {
    const res = await create(slug, cookie, name);
    expect(res.statusCode).toBe(201);
    return createdTokenDto.parse(res.json());
  }

  describe("POST /projects/:slug/tokens", () => {
    it("201: admin membuat token berawalan tp_, DB hanya menyimpan hash SHA-256", async () => {
      const { admin, project } = await setup();
      const res = await create(project.slug, admin.cookie, "  GitHub Actions  ");

      expect(res.statusCode).toBe(201);
      const created = createdTokenDto.parse(res.json());
      expect(created.name).toBe("GitHub Actions");
      expect(created.token).toMatch(/^tp_[A-Za-z0-9_-]{43}$/);

      const [row] = await app.db.select().from(projectTokens).where(eq(projectTokens.id, created.id));
      expect(row?.tokenHash).toBe(hashToken(created.token));
      expect(row?.tokenHash).not.toBe(created.token);
      expect(row?.projectId).toBe(project.id);
      expect(row?.createdBy).toBe(admin.user.id);
      expect(row?.lastUsedAt).toBeNull();
      expect(row?.revokedAt).toBeNull();
      const raw = await app.db.execute(
        sql`select count(*)::int as n from project_tokens where token_hash = ${created.token}`,
      );
      expect(Number((raw.rows[0] as { n: number }).n)).toBe(0);
    });

    it("400 VALIDATION_ERROR untuk nama kosong, terlalu panjang, null, dan bukan string", async () => {
      const { admin, project } = await setup();
      for (const name of ["", "   ", "x".repeat(61), null, 42]) {
        const res = await create(project.slug, admin.cookie, name);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
        expect(res.json().error.fields.name).toBeTypeOf("string");
      }
    });

    it("403 untuk viewer dan tester", async () => {
      const { project } = await setup();
      for (const role of ["viewer", "tester"] as const) {
        const member = await registerUser(app);
        await addMember(app, project.id, member.user.id, role);
        const res = await create(project.slug, member.cookie);
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe("FORBIDDEN");
      }
    });

    it("401 anonim; 404 PROJECT_NOT_FOUND untuk bukan anggota project privat", async () => {
      const { project } = await setup();
      expect((await create(project.slug, undefined)).statusCode).toBe(401);

      const outsider = await registerUser(app);
      const res = await create(project.slug, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("409 TOKEN_LIMIT pada token aktif ke-11; setelah mencabut satu bisa membuat lagi", async () => {
      const { admin, project } = await setup();
      const created = [];
      for (let i = 0; i < 10; i++) created.push(await createToken(project.slug, admin.cookie, `token ${i}`));

      const over = await create(project.slug, admin.cookie, "token 11");
      expect(over.statusCode).toBe(409);
      expect(over.json().error.code).toBe("TOKEN_LIMIT");

      expect((await revoke(project.slug, created[0]!.id, admin.cookie)).statusCode).toBe(204);
      const again = await create(project.slug, admin.cookie, "token 11");
      expect(again.statusCode).toBe(201);
    });

    it("batas 10 aktif berlaku per project, bukan global", async () => {
      const a = await setup();
      const b = await setup();
      for (let i = 0; i < 10; i++) await createToken(a.project.slug, a.admin.cookie, `a ${i}`);
      expect((await create(b.project.slug, b.admin.cookie)).statusCode).toBe(201);
    });

    it("pembuatan serentak tidak pernah melampaui 10 token aktif", async () => {
      const { admin, project } = await setup();
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) => create(project.slug, admin.cookie, `serentak ${i}`)),
      );
      const statuses = results.map((r) => r.statusCode);
      expect(statuses.filter((s) => s === 201)).toHaveLength(10);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);

      const res = await list(project.slug, admin.cookie);
      expect(res.json()).toHaveLength(10);
    });
  });

  describe("GET /projects/:slug/tokens", () => {
    it("200: daftar token aktif tanpa nilai token; lolos tokenDto, terbaru lebih dulu", async () => {
      const { admin, project } = await setup();
      const first = await createToken(project.slug, admin.cookie, "pertama");
      const second = await createToken(project.slug, admin.cookie, "kedua");

      const res = await list(project.slug, admin.cookie);
      expect(res.statusCode).toBe(200);
      const tokens = z.array(tokenDto).parse(res.json());
      expect(tokens.map((t) => t.id)).toEqual([second.id, first.id]);
      expect(tokens[0]).toMatchObject({
        name: "kedua",
        lastUsedAt: null,
        createdBy: { id: admin.user.id, name: admin.user.name },
      });
      expect(res.body).not.toContain(first.token);
      expect(res.body).not.toContain(second.token);
      expect(res.body).not.toContain("tp_");
      expect(res.body).not.toContain(hashToken(first.token));
    });

    it("hanya memuat token project ini", async () => {
      const a = await setup();
      const b = await setup();
      await createToken(a.project.slug, a.admin.cookie, "milik a");
      expect(z.array(tokenDto).parse((await list(b.project.slug, b.admin.cookie)).json())).toEqual([]);
    });

    it("401 anonim, 404 bukan anggota privat, 403 viewer dan tester", async () => {
      const { project } = await setup();
      expect((await list(project.slug)).statusCode).toBe(401);

      const outsider = await registerUser(app);
      expect((await list(project.slug, outsider.cookie)).statusCode).toBe(404);

      for (const role of ["viewer", "tester"] as const) {
        const member = await registerUser(app);
        await addMember(app, project.id, member.user.id, role);
        expect((await list(project.slug, member.cookie)).statusCode).toBe(403);
      }
    });
  });

  describe("DELETE /projects/:slug/tokens/:id", () => {
    it("204: mencabut token (revoked_at terisi), hilang dari daftar; cabut ulang 404 TOKEN_NOT_FOUND", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);

      expect((await revoke(project.slug, created.id, admin.cookie)).statusCode).toBe(204);
      const [row] = await app.db.select().from(projectTokens).where(eq(projectTokens.id, created.id));
      expect(row?.revokedAt).toBeInstanceOf(Date);
      expect(z.array(tokenDto).parse((await list(project.slug, admin.cookie)).json())).toEqual([]);

      const again = await revoke(project.slug, created.id, admin.cookie);
      expect(again.statusCode).toBe(404);
      expect(again.json().error.code).toBe("TOKEN_NOT_FOUND");
    });

    it("404 TOKEN_NOT_FOUND untuk id tak dikenal, bukan UUID, dan token milik project lain", async () => {
      const a = await setup();
      const b = await setup();
      const other = await createToken(b.project.slug, b.admin.cookie);

      for (const id of [UNKNOWN_ID, "bukan-uuid", other.id]) {
        const res = await revoke(a.project.slug, id, a.admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("TOKEN_NOT_FOUND");
      }
      // Token milik project lain tetap aktif.
      expect(z.array(tokenDto).parse((await list(b.project.slug, b.admin.cookie)).json())).toHaveLength(1);
    });

    it("401 anonim, 404 bukan anggota privat, 403 viewer dan tester", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);
      expect((await revoke(project.slug, created.id)).statusCode).toBe(401);

      const outsider = await registerUser(app);
      expect((await revoke(project.slug, created.id, outsider.cookie)).statusCode).toBe(404);

      for (const role of ["viewer", "tester"] as const) {
        const member = await registerUser(app);
        await addMember(app, project.id, member.user.id, role);
        expect((await revoke(project.slug, created.id, member.cookie)).statusCode).toBe(403);
      }
      expect(z.array(tokenDto).parse((await list(project.slug, admin.cookie)).json())).toHaveLength(1);
    });
  });

  describe("authenticateIngestToken / touchToken", () => {
    it("token valid -> { tokenId, projectId }", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);
      const auth = await authenticateIngestToken(app.db, `Bearer ${created.token}`);
      expect(auth).toEqual({ tokenId: created.id, projectId: project.id });
    });

    it("token dicabut -> null", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);
      await revoke(project.slug, created.id, admin.cookie);
      expect(await authenticateIngestToken(app.db, `Bearer ${created.token}`)).toBeNull();
    });

    it("token salah, tanpa header, dan header berformat salah -> null", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);
      const wrong = `tp_${"A".repeat(43)}`;
      const cases: Array<string | undefined> = [
        undefined,
        "",
        "Bearer",
        "Bearer ",
        `Bearer ${wrong}`,
        "Bearer xyz",
        // tanpa prefix tp_ walau nilainya benar
        `Bearer ${created.token.slice(3)}`,
        // skema selain Bearer
        `Basic ${created.token}`,
        created.token,
        // spasi berlebih / token ganda
        `Bearer  ${created.token}`,
        `Bearer ${created.token} ekstra`,
      ];
      for (const header of cases) {
        expect(await authenticateIngestToken(app.db, header)).toBeNull();
      }
    });

    it("skema Bearer tidak peka huruf besar-kecil; nilai token tetap peka", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);
      expect(await authenticateIngestToken(app.db, `bearer ${created.token}`)).toEqual({
        tokenId: created.id,
        projectId: project.id,
      });
      expect(await authenticateIngestToken(app.db, `Bearer ${created.token.toLowerCase()}`)).toBeNull();
    });

    it("touchToken mengisi last_used_at dan tampil di daftar", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);
      const before = Date.now();
      await touchToken(app.db, created.id);

      const [row] = await app.db.select().from(projectTokens).where(eq(projectTokens.id, created.id));
      expect(row?.lastUsedAt).toBeInstanceOf(Date);
      expect(row!.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

      const tokens = z.array(tokenDto).parse((await list(project.slug, admin.cookie)).json());
      expect(tokens[0]?.lastUsedAt).not.toBeNull();
    });
  });

  describe("skema database", () => {
    it("migrasi membuat project_tokens, runs, test_cases, test_results", async () => {
      const res = await app.db.execute(
        sql`select table_name from information_schema.tables
            where table_schema = 'public' and table_name in ('project_tokens','runs','test_cases','test_results')`,
      );
      const names = (res.rows as Array<{ table_name: string }>).map((r) => r.table_name).sort();
      expect(names).toEqual(["project_tokens", "runs", "test_cases", "test_results"]);
    });

    async function uniqueColumnSets(table: string): Promise<string[]> {
      const res = await app.db.execute(
        sql`select array_agg(a.attname order by k.ord) as cols
            from pg_index i
            join pg_class c on c.oid = i.indrelid
            cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
            where c.relname = ${table} and i.indisunique and not i.indisprimary
            group by i.indexrelid`,
      );
      return (res.rows as Array<{ cols: string[] | string }>)
        .map((r) => (Array.isArray(r.cols) ? r.cols : String(r.cols).replace(/[{}]/g, "").split(",")).join(","))
        .sort();
    }

    it("unique (project_id, suite, name) pada test_cases", async () => {
      expect(await uniqueColumnSets("test_cases")).toContain("project_id,suite,name");
    });

    it("unique (run_id, test_case_id) pada test_results", async () => {
      expect(await uniqueColumnSets("test_results")).toContain("run_id,test_case_id");
    });

    it("token_hash unik pada project_tokens", async () => {
      expect(await uniqueColumnSets("project_tokens")).toContain("token_hash");
    });

    it("indeks runs dan test_results sesuai spec", async () => {
      const res = await app.db.execute(
        sql`select tablename, indexdef from pg_indexes
            where schemaname = 'public' and tablename in ('runs','test_results')`,
      );
      const defs = (res.rows as Array<{ tablename: string; indexdef: string }>).map((r) => r.indexdef);
      expect(defs.some((d) => /ON public\.runs .*\(project_id, branch, created_at DESC\)/.test(d))).toBe(true);
      expect(defs.some((d) => /ON public\.runs .*\(project_id, created_at DESC\)/.test(d))).toBe(true);
      expect(defs.some((d) => /ON public\.test_results .*\(test_case_id, run_id\)/.test(d))).toBe(true);
    });

    it("aturan cascade: menghapus project menghapus token; menghapus token membuat runs.token_id NULL", async () => {
      const { admin, project } = await setup();
      const created = await createToken(project.slug, admin.cookie);
      const run = await app.db.execute(
        sql`insert into runs (project_id, branch, duration_ms, total, passed, failed, skipped, flaky, token_id)
            values (${project.id}, 'main', 1, 1, 1, 0, 0, 0, ${created.id}) returning id`,
      );
      const runId = (run.rows[0] as { id: string }).id;

      await app.db.delete(projectTokens).where(eq(projectTokens.id, created.id));
      const after = await app.db.execute(sql`select token_id from runs where id = ${runId}`);
      expect((after.rows[0] as { token_id: string | null }).token_id).toBeNull();

      await app.db.execute(sql`delete from projects where id = ${project.id}`);
      const gone = await app.db.execute(sql`select count(*)::int as n from runs where id = ${runId}`);
      expect((gone.rows[0] as { n: number }).n).toBe(0);
    });

    it("CHECK status test_results menolak nilai di luar passed/failed/skipped", async () => {
      const { project } = await setup();
      const run = await app.db.execute(
        sql`insert into runs (project_id, branch, duration_ms, total, passed, failed, skipped, flaky)
            values (${project.id}, 'main', 1, 1, 1, 0, 0, 0) returning id`,
      );
      const tc = await app.db.execute(
        sql`insert into test_cases (project_id, suite, name) values (${project.id}, 's', 'n') returning id`,
      );
      const runId = (run.rows[0] as { id: string }).id;
      const tcId = (tc.rows[0] as { id: string }).id;
      await expect(
        app.db.execute(
          sql`insert into test_results (run_id, test_case_id, status, flaky_in_run, retries, duration_ms)
              values (${runId}, ${tcId}, 'weird', false, 0, 1)`,
        ),
      ).rejects.toThrow();
    });
  });
});
