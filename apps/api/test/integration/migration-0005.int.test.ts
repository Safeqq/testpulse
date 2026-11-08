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
/** Migrasi 0000–0004 = skema Tahap 3 yang sudah di produksi; 0005 menambah tabel test manual yang diuji di sini. */
const BEFORE_0005 = 5;

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

describe("migrasi 0005 (tabel test manual) di atas data Tahap 3", () => {
  const dbName = `mig0005_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
  let pool: pg.Pool;
  let tmpFolder: string;

  const ids = {
    user: randomUUID(),
    project: randomUUID(),
    run: randomUUID(),
    testCase: randomUUID(),
    bug: randomUUID(),
    comment: randomUUID(),
  };

  /** Pesan galat Postgres (kode SQLSTATE + nama constraint) dari query yang diharapkan gagal. */
  const failure = async (text: string, params: unknown[] = []) => {
    try {
      await pool.query(text, params);
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      return { code: e.code, constraint: e.constraint };
    }
    return null;
  };

  const newSuite = async (name: string, position = 0) => {
    const id = randomUUID();
    await pool.query("insert into case_suites (id, project_id, name, position) values ($1, $2, $3, $4)", [id, ids.project, name, position]);
    return id;
  };

  const newCase = async (suiteId: string, number: number, automatedTestId: string | null = null) => {
    const id = randomUUID();
    await pool.query(
      `insert into manual_cases (id, project_id, number, suite_id, title, steps, automated_test_id, created_by, updated_by)
       values ($1, $2, $3, $4, 'Judul case', '[{"action":"a","expected":"b"}]'::jsonb, $5, $6, $6)`,
      [id, ids.project, number, suiteId, automatedTestId, ids.user],
    );
    return id;
  };

  const newManualRun = async (number: number) => {
    const id = randomUUID();
    await pool.query("insert into manual_runs (id, project_id, number, name, created_by) values ($1, $2, $3, 'Run uji', $4)", [
      id,
      ids.project,
      number,
      ids.user,
    ]);
    return id;
  };

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });

    // 1. DB sampai skema 0004, lengkap dengan run berversi, bug, dan komentar.
    tmpFolder = await truncatedMigrations(BEFORE_0005);
    await migrate(drizzle(pool, { schema }), { migrationsFolder: tmpFolder });
    await pool.query("insert into users (id, email, name, password_hash) values ($1, 'lama@example.test', 'Lama', 'x')", [ids.user]);
    await pool.query("insert into projects (id, name, slug, created_by, bug_seq) values ($1, 'Lama', 'proyek-lama', $2, 3)", [
      ids.project,
      ids.user,
    ]);
    await pool.query(
      `insert into runs (id, project_id, branch, duration_ms, total, passed, failed, skipped, flaky, version)
       values ($1, $2, 'main', 1000, 1, 0, 1, 0, 0, 'v1.2.0')`,
      [ids.run, ids.project],
    );
    await pool.query("insert into test_cases (id, project_id, suite, name) values ($1, $2, 's', 'lama')", [ids.testCase, ids.project]);
    await pool.query(
      `insert into bugs (id, project_id, number, title, reporter_id, test_case_id, run_id)
       values ($1, $2, 1, 'Bug lama', $3, $4, $5)`,
      [ids.bug, ids.project, ids.user, ids.testCase, ids.run],
    );
    await pool.query("insert into bug_comments (id, bug_id, author_id, body) values ($1, $2, $3, 'Komentar lama')", [
      ids.comment,
      ids.bug,
      ids.user,
    ]);

    // 2. Terapkan semua migrasi (menambah 0005).
    await runMigrations(drizzle(pool, { schema }));
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(tmpFolder, { recursive: true, force: true });
  });

  it("data Tahap 3 utuh; counter baru = 0; bug lama tanpa asal manual", async () => {
    const project = await pool.query("select bug_seq, case_seq, manual_run_seq from projects where id = $1", [ids.project]);
    expect(project.rows).toEqual([{ bug_seq: 3, case_seq: 0, manual_run_seq: 0 }]);
    const run = await pool.query("select version from runs where id = $1", [ids.run]);
    expect(run.rows).toEqual([{ version: "v1.2.0" }]);
    const bug = await pool.query("select title, run_id, test_case_id, manual_run_case_id from bugs where id = $1", [ids.bug]);
    expect(bug.rows).toEqual([{ title: "Bug lama", run_id: ids.run, test_case_id: ids.testCase, manual_run_case_id: null }]);
    const comment = await pool.query("select body from bug_comments where id = $1", [ids.comment]);
    expect(comment.rows).toEqual([{ body: "Komentar lama" }]);
  });

  it("nama suite unik per project tanpa peka huruf besar/kecil, tetapi boleh sama di project lain", async () => {
    await newSuite("Login", 0);
    expect(await failure("insert into case_suites (project_id, name, position) values ($1, 'login', 1)", [ids.project])).toMatchObject({
      code: "23505",
    });

    const otherProject = randomUUID();
    await pool.query("insert into projects (id, name, slug, created_by) values ($1, 'Lain', 'proyek-lain', $2)", [otherProject, ids.user]);
    expect(await failure("insert into case_suites (project_id, name, position) values ($1, 'login', 0)", [otherProject])).toBeNull();
  });

  it("menghapus suite yang masih punya case ditolak FK RESTRICT; suite kosong terhapus", async () => {
    const suiteId = await newSuite("Dengan case", 1);
    await newCase(suiteId, 1);
    expect(await failure("delete from case_suites where id = $1", [suiteId])).toMatchObject({ code: "23503" });

    const emptySuite = await newSuite("Kosong", 2);
    expect(await failure("delete from case_suites where id = $1", [emptySuite])).toBeNull();
  });

  it("nilai bawaan dan CHECK enum (prioritas, status run, status run case)", async () => {
    const suiteId = await newSuite("Bawaan", 3);
    const caseId = await newCase(suiteId, 2);
    const c = await pool.query("select priority, preconditions, version, archived_at from manual_cases where id = $1", [caseId]);
    expect(c.rows).toEqual([{ priority: "medium", preconditions: "", version: 1, archived_at: null }]);
    expect(
      await failure(
        "insert into manual_cases (project_id, number, suite_id, title, steps, priority, created_by, updated_by) values ($1, 99, $2, 't', '[]'::jsonb, 'kritis', $3, $3)",
        [ids.project, suiteId, ids.user],
      ),
    ).toMatchObject({ code: "23514", constraint: "manual_cases_priority_check" });

    const runId = await newManualRun(1);
    const r = await pool.query("select status, version, app_version from manual_runs where id = $1", [runId]);
    expect(r.rows).toEqual([{ status: "open", version: 1, app_version: null }]);
    expect(await failure("update manual_runs set status = 'selesai' where id = $1", [runId])).toMatchObject({
      code: "23514",
      constraint: "manual_runs_status_check",
    });

    const rc = await pool.query(
      `insert into manual_run_cases (run_id, case_id, position, case_number, suite_name, suite_position, title, steps, priority, step_results)
       values ($1, $2, 0, 2, 'Bawaan', 3, 'Judul case', '[]'::jsonb, 'medium', '[]'::jsonb) returning status, note, version`,
      [runId, caseId],
    );
    expect(rc.rows).toEqual([{ status: "untested", note: "", version: 1 }]);
    expect(await failure("update manual_run_cases set status = 'done' where run_id = $1", [runId])).toMatchObject({
      code: "23514",
      constraint: "manual_run_cases_status_check",
    });
  });

  it("nomor case dan nomor run unik per project", async () => {
    const suiteId = await newSuite("Nomor", 4);
    await newCase(suiteId, 10);
    expect(
      await failure(
        "insert into manual_cases (project_id, number, suite_id, title, steps, created_by, updated_by) values ($1, 10, $2, 't', '[]'::jsonb, $3, $3)",
        [ids.project, suiteId, ids.user],
      ),
    ).toMatchObject({ code: "23505", constraint: "manual_cases_project_number_unique" });

    await newManualRun(10);
    expect(
      await failure("insert into manual_runs (project_id, number, name, created_by) values ($1, 10, 'Dobel', $2)", [ids.project, ids.user]),
    ).toMatchObject({ code: "23505", constraint: "manual_runs_project_number_unique" });
  });

  it("menghapus test_cases mengosongkan manual_cases.automated_test_id", async () => {
    const suiteId = await newSuite("Otomasi", 5);
    const caseId = await newCase(suiteId, 20, ids.testCase);
    await pool.query("delete from test_cases where id = $1", [ids.testCase]);
    const c = await pool.query("select automated_test_id from manual_cases where id = $1", [caseId]);
    expect(c.rows).toEqual([{ automated_test_id: null }]);
  });

  it("menghapus manual_run_cases mengosongkan bugs.manual_run_case_id; menghapus case mengosongkan manual_run_cases.case_id", async () => {
    const suiteId = await newSuite("Run case", 6);
    const caseId = await newCase(suiteId, 30);
    const runId = await newManualRun(30);
    const runCaseId = randomUUID();
    await pool.query(
      `insert into manual_run_cases (id, run_id, case_id, position, case_number, suite_name, suite_position, title, steps, priority, step_results)
       values ($1, $2, $3, 0, 30, 'Run case', 6, 'Judul case', '[]'::jsonb, 'medium', '[]'::jsonb)`,
      [runCaseId, runId, caseId],
    );
    await pool.query("update bugs set manual_run_case_id = $1 where id = $2", [runCaseId, ids.bug]);

    await pool.query("delete from manual_cases where id = $1", [caseId]);
    const rc = await pool.query("select case_id, title from manual_run_cases where id = $1", [runCaseId]);
    expect(rc.rows).toEqual([{ case_id: null, title: "Judul case" }]);

    await pool.query("delete from manual_runs where id = $1", [runId]);
    const bug = await pool.query("select title, manual_run_case_id from bugs where id = $1", [ids.bug]);
    expect(bug.rows).toEqual([{ title: "Bug lama", manual_run_case_id: null }]);
  });

  it("label case ikut terhapus bersama case-nya", async () => {
    const suiteId = await newSuite("Label", 7);
    const caseId = await newCase(suiteId, 40);
    await pool.query("insert into manual_case_labels (case_id, label) values ($1, 'smoke')", [caseId]);
    expect(await failure("insert into manual_case_labels (case_id, label) values ($1, 'smoke')", [caseId])).toMatchObject({ code: "23505" });
    await pool.query("delete from manual_cases where id = $1", [caseId]);
    const labels = await pool.query("select 1 from manual_case_labels where case_id = $1", [caseId]);
    expect(labels.rowCount).toBe(0);
  });

  it("indeks bernama spec §6 terbentuk (ekspresi lower(name) dan indeks parsial)", async () => {
    const rows = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public'
       and tablename in ('case_suites', 'manual_cases', 'manual_runs', 'manual_run_cases', 'bugs')`,
    );
    const defs = rows.rows.map((r) => r.indexdef.replaceAll('"', "").replaceAll(/\s+/g, " "));
    const has = (re: RegExp) => defs.some((d) => re.test(d));
    expect(has(/UNIQUE INDEX .* ON public\.case_suites USING btree \(project_id, lower\(name\)\)/)).toBe(true);
    expect(has(/ON public\.case_suites USING btree \(project_id, "?position"?\)/)).toBe(true);
    expect(has(/ON public\.manual_cases USING btree \(project_id, suite_id, number\)/)).toBe(true);
    expect(has(/ON public\.manual_cases USING btree \(automated_test_id\) WHERE \(?automated_test_id IS NOT NULL/)).toBe(true);
    expect(has(/ON public\.manual_runs USING btree \(project_id, created_at DESC\)/)).toBe(true);
    expect(has(/ON public\.manual_runs USING btree \(project_id, app_version\)/)).toBe(true);
    expect(has(/ON public\.manual_run_cases USING btree \(run_id, "?position"?\)/)).toBe(true);
    expect(has(/ON public\.manual_run_cases USING btree \(run_id, status\)/)).toBe(true);
    expect(has(/ON public\.manual_run_cases USING btree \(case_id\)/)).toBe(true);
    expect(has(/ON public\.bugs USING btree \(manual_run_case_id\) WHERE \(?status <> 'closed'/)).toBe(true);
  });
});
