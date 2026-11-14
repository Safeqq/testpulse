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
/** Migrasi 0000–0005 = skema Tahap 4 awal; 0006 menambah indeks penuh `bugs.manual_run_case_id` yang diuji di sini. */
const BEFORE_0006 = 6;

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

describe("migrasi 0006 (indeks penuh bugs.manual_run_case_id) di atas data 0005", () => {
  const dbName = `mig0006_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
  let pool: pg.Pool;
  let tmpFolder: string;

  const ids = {
    user: randomUUID(),
    project: randomUUID(),
    suite: randomUUID(),
    manualCase: randomUUID(),
    manualRun: randomUUID(),
    runCase: randomUUID(),
    openBug: randomUUID(),
    closedBug: randomUUID(),
  };

  const bugIndexDefs = async () => {
    const rows = await pool.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'bugs'",
    );
    return new Map(rows.rows.map((r) => [r.indexname, r.indexdef.replaceAll('"', "").replaceAll(/\s+/g, " ")]));
  };

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });

    // 1. DB sampai skema 0005, dengan run case yang punya bug terbuka dan bug tertutup.
    tmpFolder = await truncatedMigrations(BEFORE_0006);
    await migrate(drizzle(pool, { schema }), { migrationsFolder: tmpFolder });
    await pool.query("insert into users (id, email, name, password_hash) values ($1, 'lama@example.test', 'Lama', 'x')", [ids.user]);
    await pool.query("insert into projects (id, name, slug, created_by, bug_seq) values ($1, 'Lama', 'proyek-lama', $2, 2)", [
      ids.project,
      ids.user,
    ]);
    await pool.query("insert into case_suites (id, project_id, name, position) values ($1, $2, 'Login', 0)", [ids.suite, ids.project]);
    await pool.query(
      `insert into manual_cases (id, project_id, number, suite_id, title, steps, created_by, updated_by)
       values ($1, $2, 1, $3, 'Judul case', '[{"action":"a","expected":"b"}]'::jsonb, $4, $4)`,
      [ids.manualCase, ids.project, ids.suite, ids.user],
    );
    await pool.query("insert into manual_runs (id, project_id, number, name, created_by) values ($1, $2, 1, 'Run uji', $3)", [
      ids.manualRun,
      ids.project,
      ids.user,
    ]);
    await pool.query(
      `insert into manual_run_cases (id, run_id, case_id, position, case_number, suite_name, suite_position, title, steps, priority, step_results)
       values ($1, $2, $3, 0, 1, 'Login', 0, 'Judul case', '[]'::jsonb, 'medium', '[]'::jsonb)`,
      [ids.runCase, ids.manualRun, ids.manualCase],
    );
    await pool.query(
      `insert into bugs (id, project_id, number, title, reporter_id, manual_run_case_id, status)
       values ($1, $3, 1, 'Bug terbuka', $4, $5, 'open'), ($2, $3, 2, 'Bug tertutup', $4, $5, 'closed')`,
      [ids.openBug, ids.closedBug, ids.project, ids.user, ids.runCase],
    );

    // 2. Terapkan semua migrasi (menambah 0006).
    await runMigrations(drizzle(pool, { schema }));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(tmpFolder, { recursive: true, force: true });
  });

  it("indeks penuh baru terbentuk; indeks parsial untuk badge tetap ada", async () => {
    const defs = await bugIndexDefs();
    expect(defs.get("bugs_manual_run_case_idx")).toMatch(/ON public\.bugs USING btree \(manual_run_case_id\)$/);
    expect(defs.get("bugs_manual_run_case_open_idx")).toMatch(
      /ON public\.bugs USING btree \(manual_run_case_id\) WHERE \(?status <> 'closed'/,
    );
  });

  it("pencarian FK SET NULL (termasuk bug tertutup) memakai indeks penuh, bukan seq scan", async () => {
    const client = await pool.connect();
    try {
      // Tabel uji sangat kecil, jadi seq scan dimatikan agar planner menunjukkan indeks yang bisa dipakai. Tanpa indeks
      // penuh, planner tetap memilih Seq Scan: indeks parsial tidak berlaku untuk predikat tanpa `status <> 'closed'`.
      await client.query("set enable_seqscan = off");
      const plan = await client.query<{ "QUERY PLAN": string }>(
        "explain update bugs set manual_run_case_id = null where manual_run_case_id = $1",
        [ids.runCase],
      );
      const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(text).toMatch(/Index (Only )?Scan using bugs_manual_run_case_idx|Bitmap Index Scan on bugs_manual_run_case_idx/);
      expect(text).not.toMatch(/Seq Scan/);
    } finally {
      await client.query("reset enable_seqscan");
      client.release();
    }
  });

  it("data 0005 utuh; menghapus run case tetap mengosongkan asal manual bug terbuka dan tertutup", async () => {
    const before = await pool.query("select id, manual_run_case_id from bugs where project_id = $1 order by number", [ids.project]);
    expect(before.rows).toEqual([
      { id: ids.openBug, manual_run_case_id: ids.runCase },
      { id: ids.closedBug, manual_run_case_id: ids.runCase },
    ]);
    await pool.query("delete from manual_run_cases where id = $1", [ids.runCase]);
    const after = await pool.query("select manual_run_case_id from bugs where project_id = $1 order by number", [ids.project]);
    expect(after.rows).toEqual([{ manual_run_case_id: null }, { manual_run_case_id: null }]);
  });
});
