import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import * as schema from "../../src/db/schema.js";

const drizzleFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
/** Migrasi 0000–0002 = skema akhir Tahap 2; 0003 adalah migrasi Tahap 3 yang diuji. */
const TAHAP2_MIGRATIONS = 3;

interface Journal {
  entries: { tag: string }[];
}

/** Salinan folder migrasi yang jurnalnya dipotong sampai `count` entri pertama (migrator Drizzle tidak punya "migrate sampai"). */
async function truncatedMigrations(count: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tp-migrations-"));
  await cp(drizzleFolder, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  journal.entries = journal.entries.slice(0, count);
  await writeFile(journalPath, JSON.stringify(journal));
  return dir;
}

describe("migrasi 0003 (Tahap 3) di atas data Tahap 2", () => {
  const dbName = `mig0003_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
  let pool: pg.Pool;
  let tmpFolder: string;

  const ids = {
    user: randomUUID(),
    project: randomUUID(),
    run: randomUUID(),
    testCase: randomUUID(),
  };

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });

    // 1. DB hanya sampai skema Tahap 2.
    tmpFolder = await truncatedMigrations(TAHAP2_MIGRATIONS);
    await migrate(drizzle(pool, { schema }), { migrationsFolder: tmpFolder });
    const tahap2 = await pool.query<{ tables: string[] }>(
      "select array_agg(table_name::text) as tables from information_schema.tables where table_schema = 'public'",
    );
    expect(tahap2.rows[0]?.tables).not.toContain("bugs");

    // 2. Data Tahap 2.
    await pool.query("insert into users (id, email, name, password_hash) values ($1, 'lama@example.test', 'Lama', 'x')", [ids.user]);
    await pool.query("insert into projects (id, name, slug, created_by) values ($1, 'Lama', 'proyek-lama', $2)", [ids.project, ids.user]);
    await pool.query(
      `insert into runs (id, project_id, branch, duration_ms, total, passed, failed, skipped, flaky)
       values ($1, $2, 'main', 1000, 2, 1, 1, 0, 0)`,
      [ids.run, ids.project],
    );
    await pool.query("insert into test_cases (id, project_id, suite, name) values ($1, $2, 's', 'lama')", [ids.testCase, ids.project]);
    await pool.query(
      `insert into test_results (run_id, test_case_id, status, flaky_in_run, retries, duration_ms, message)
       values ($1, $2, 'failed', false, 0, 10, 'gagal')`,
      [ids.run, ids.testCase],
    );

    // 3. Terapkan semua migrasi (menambah 0003) di atas data tersebut.
    await runMigrations(drizzle(pool, { schema }));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(tmpFolder, { recursive: true, force: true });
  });

  it("data lama utuh; runs.version NULL dan projects.bug_seq 0", async () => {
    const run = await pool.query("select branch, total, version from runs where id = $1", [ids.run]);
    expect(run.rows).toEqual([{ branch: "main", total: 2, version: null }]);
    const project = await pool.query("select slug, bug_seq from projects where id = $1", [ids.project]);
    expect(project.rows).toEqual([{ slug: "proyek-lama", bug_seq: 0 }]);
    const results = await pool.query("select status, message from test_results where run_id = $1", [ids.run]);
    expect(results.rows).toEqual([{ status: "failed", message: "gagal" }]);
    const users = await pool.query("select email from users where id = $1", [ids.user]);
    expect(users.rows).toEqual([{ email: "lama@example.test" }]);
  });

  it("tabel bug dan indeks spec §5 terbentuk, termasuk indeks parsial", async () => {
    const tables = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'bug%' order by 1",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(["bug_comments", "bug_events", "bug_labels", "bug_links", "bugs"]);

    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and (tablename like 'bug%' or tablename = 'runs')",
    );
    const defs = indexes.rows.map((r) => r.indexdef.replaceAll('"', "").replaceAll(/\s+/g, " "));
    expect(defs.some((d) => d.includes("ON public.runs USING btree (project_id, branch, version)"))).toBe(true);
    expect(defs.some((d) => /ON public\.bugs USING btree \(project_id, status, updated_at DESC\)/.test(d))).toBe(true);
    expect(defs.some((d) => d.includes("ON public.bugs USING btree (project_id, assignee_id)"))).toBe(true);
    expect(defs.some((d) => /ON public\.bugs USING btree \(test_case_id\) WHERE \(?status <> 'closed'/.test(d))).toBe(true);
    expect(defs.some((d) => d.includes("ON public.bug_comments USING btree (bug_id, created_at)"))).toBe(true);
    expect(defs.some((d) => d.includes("ON public.bug_events USING btree (bug_id, created_at)"))).toBe(true);
  });

  it("CHECK menolak nilai di luar enum; default priority/severity/version", async () => {
    const insert = (status: string, priority = "medium") =>
      pool.query(
        `insert into bugs (project_id, number, title, description, status, priority, severity, reporter_id)
         values ($1, $2, 't', '', $3, $4, 'major', $5)`,
        [ids.project, Math.floor(Math.random() * 1e9), status, priority, ids.user],
      );
    await expect(insert("tidak-ada")).rejects.toThrow(/bugs_status_check/);
    await expect(insert("open", "darurat")).rejects.toThrow(/bugs_priority_check/);
    await expect(
      pool.query(
        `insert into bugs (project_id, number, title, description, status, resolution, priority, severity, reporter_id)
         values ($1, 9000001, 't', '', 'resolved', 'bukan-resolusi', 'low', 'minor', $2)`,
        [ids.project, ids.user],
      ),
    ).rejects.toThrow(/bugs_resolution_check/);
    await expect(
      pool.query(
        `insert into bugs (project_id, number, title, description, status, priority, severity, reporter_id)
         values ($1, 9000002, 't', '', 'open', 'low', 'sangat', $2)`,
        [ids.project, ids.user],
      ),
    ).rejects.toThrow(/bugs_severity_check/);

    const ok = await pool.query<{ version: number }>(
      `insert into bugs (project_id, number, title, description, status, priority, severity, reporter_id)
       values ($1, 9000003, 't', '', 'open', 'low', 'minor', $2) returning version`,
      [ids.project, ids.user],
    );
    expect(ok.rows[0]?.version).toBe(1);
    await pool.query("delete from bugs where project_id = $1", [ids.project]);
  });

  it("nomor bug unik per project", async () => {
    const insert = () =>
      pool.query(
        `insert into bugs (project_id, number, title, description, status, priority, severity, reporter_id)
         values ($1, 1, 't', '', 'open', 'low', 'minor', $2)`,
        [ids.project, ids.user],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/bugs_project_number_unique/);
    await pool.query("delete from bugs where project_id = $1", [ids.project]);
  });

  it("aturan ON DELETE: run/test_case -> SET NULL, anak bug -> CASCADE, project -> CASCADE", async () => {
    const bug = await pool.query<{ id: string }>(
      `insert into bugs (project_id, number, title, description, status, priority, severity, reporter_id, test_case_id, run_id)
       values ($1, 77, 't', '', 'open', 'low', 'minor', $2, $3, $4) returning id`,
      [ids.project, ids.user, ids.testCase, ids.run],
    );
    const bugId = bug.rows[0]!.id;
    await pool.query("insert into bug_labels (bug_id, label) values ($1, 'ui')", [bugId]);
    await pool.query("insert into bug_links (bug_id, position, url) values ($1, 0, 'https://example.test')", [bugId]);
    await pool.query("insert into bug_comments (bug_id, author_id, body) values ($1, $2, 'halo')", [bugId, ids.user]);
    await pool.query("insert into bug_events (bug_id, actor_id, field) values ($1, $2, 'created')", [bugId, ids.user]);

    await pool.query("delete from runs where id = $1", [ids.run]);
    await pool.query("delete from test_cases where id = $1", [ids.testCase]);
    const kept = await pool.query("select run_id, test_case_id from bugs where id = $1", [bugId]);
    expect(kept.rows).toEqual([{ run_id: null, test_case_id: null }]);

    // Project dihapus -> bug dan semua anaknya ikut terhapus.
    await pool.query("delete from projects where id = $1", [ids.project]);
    for (const table of ["bugs", "bug_labels", "bug_links", "bug_comments", "bug_events"]) {
      const left = await pool.query(`select count(*)::int as n from ${table}`);
      expect(left.rows[0]?.n, table).toBe(0);
    }
  });
});
