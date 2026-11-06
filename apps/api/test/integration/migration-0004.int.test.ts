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
/** Migrasi 0000–0003 = skema Tahap 3 yang sudah di produksi; 0004 menambah indeks yang diuji di sini. */
const BEFORE_0004 = 4;

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

describe("migrasi 0004 (indeks bug) di atas data Tahap 3", () => {
  const dbName = `mig0004_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
  let pool: pg.Pool;
  let tmpFolder: string;

  const ids = { user: randomUUID(), project: randomUUID(), run: randomUUID(), testCase: randomUUID(), bug: randomUUID() };

  const indexDefs = async () => {
    const rows = await pool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and tablename in ('bugs', 'bug_links')",
    );
    return rows.rows.map((r) => r.indexdef.replaceAll('"', "").replaceAll(/\s+/g, " "));
  };

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });

    // 1. DB sampai skema 0003, lengkap dengan bug dan link-nya.
    tmpFolder = await truncatedMigrations(BEFORE_0004);
    await migrate(drizzle(pool, { schema }), { migrationsFolder: tmpFolder });
    await pool.query("insert into users (id, email, name, password_hash) values ($1, 'lama@example.test', 'Lama', 'x')", [ids.user]);
    await pool.query("insert into projects (id, name, slug, created_by) values ($1, 'Lama', 'proyek-lama', $2)", [ids.project, ids.user]);
    await pool.query(
      `insert into runs (id, project_id, branch, duration_ms, total, passed, failed, skipped, flaky)
       values ($1, $2, 'main', 1000, 1, 0, 1, 0, 0)`,
      [ids.run, ids.project],
    );
    await pool.query("insert into test_cases (id, project_id, suite, name) values ($1, $2, 's', 'lama')", [ids.testCase, ids.project]);
    await pool.query(
      `insert into bugs (id, project_id, number, title, status, reporter_id, test_case_id, run_id)
       values ($1, $2, 1, 'Bug lama', 'closed', $3, $4, $5)`,
      [ids.bug, ids.project, ids.user, ids.testCase, ids.run],
    );
    await pool.query(
      "insert into bug_links (bug_id, position, url) values ($1, 1, 'https://example.test/b'), ($1, 0, 'https://example.test/a')",
      [ids.bug],
    );
    expect((await indexDefs()).some((d) => d.includes("ON public.bugs USING btree (run_id)"))).toBe(false);

    // 2. Terapkan semua migrasi (menambah 0004).
    await runMigrations(drizzle(pool, { schema }));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(tmpFolder, { recursive: true, force: true });
  });

  it("indeks bug_links (bug_id, position), bugs (run_id), bugs (test_case_id) terbentuk; indeks parsial lencana tetap", async () => {
    const defs = await indexDefs();
    expect(defs.some((d) => d.endsWith("ON public.bug_links USING btree (bug_id, position)"))).toBe(true);
    expect(defs.some((d) => d.endsWith("ON public.bugs USING btree (run_id)"))).toBe(true);
    expect(defs.some((d) => d.endsWith("ON public.bugs USING btree (test_case_id)"))).toBe(true);
    expect(defs.some((d) => /ON public\.bugs USING btree \(test_case_id\) WHERE \(?status <> 'closed'/.test(d))).toBe(true);
  });

  it("data lama utuh; hapus run/test tetap SET NULL", async () => {
    const links = await pool.query("select url from bug_links where bug_id = $1 order by position", [ids.bug]);
    expect(links.rows).toEqual([{ url: "https://example.test/a" }, { url: "https://example.test/b" }]);

    await pool.query("delete from runs where id = $1", [ids.run]);
    await pool.query("delete from test_cases where id = $1", [ids.testCase]);
    const bug = await pool.query("select title, run_id, test_case_id from bugs where id = $1", [ids.bug]);
    expect(bug.rows).toEqual([{ title: "Bug lama", run_id: null, test_case_id: null }]);
  });
});
