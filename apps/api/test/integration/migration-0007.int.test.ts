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
import { closePoolAndDropDatabase } from "./drop-database.js";

const drizzleFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
/** Migrasi 0000–0006 = skema Tahap 4 lengkap; 0007 menambah tabel crowdtesting (spec Tahap 5 §7). */
const BEFORE_0007 = 7;

interface Journal {
  entries: { tag: string }[];
}

async function truncatedMigrations(count: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "tp-migrations-"));
  await cp(drizzleFolder, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  journal.entries = journal.entries.slice(0, count);
  await writeFile(journalPath, JSON.stringify(journal));
  return dir;
}

const pgCode = (error: unknown) => (error as { code?: string }).code;
const pgConstraint = (error: unknown) => (error as { constraint?: string }).constraint;

describe("migrasi 0007 (crowdtesting) di atas data Tahap 4", () => {
  const dbName = `mig0007_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
  let pool: pg.Pool;
  let tmpFolder: string;

  const ids = {
    owner: randomUUID(),
    tester: randomUUID(),
    project: randomUUID(),
    suite: randomUUID(),
    manualCase: randomUUID(),
    bug: randomUUID(),
  };

  /** Satu project baru dengan cycle + laporan; dipakai test yang menghapus atau mengubah data. */
  async function seedCrowd(label: string) {
    const project = randomUUID();
    const cycle = randomUUID();
    const report = randomUUID();
    const bug = randomUUID();
    await pool.query("insert into projects (id, name, slug, created_by) values ($1, $2, $3, $4)", [
      project,
      label,
      `p-${project.slice(0, 8)}`,
      ids.owner,
    ]);
    await pool.query(
      `insert into crowd_cycles (id, project_id, number, title, status, created_by) values ($1, $2, 1, 'Uji', 'open', $3)`,
      [cycle, project, ids.owner],
    );
    await pool.query("insert into crowd_cycle_links (id, cycle_id, position, url, label) values ($1, $2, 0, 'https://x.io', 'Web')", [
      randomUUID(),
      cycle,
    ]);
    await pool.query("insert into crowd_cycle_environments (cycle_id, position, label) values ($1, 0, 'Chrome')", [cycle]);
    await pool.query("insert into crowd_participants (cycle_id, user_id, status) values ($1, $2, 'active')", [cycle, ids.tester]);
    await pool.query(
      `insert into crowd_reports (id, project_id, cycle_id, number, reporter_id, title, steps, expected, actual, environment,
                                  suggested_severity, status)
       values ($1, $2, $3, 1, $4, 'Judul', 'Langkah panjang', 'a', 'b', 'Chrome', 'major', 'submitted')`,
      [report, project, cycle, ids.tester],
    );
    await pool.query(
      `insert into bugs (id, project_id, number, title, reporter_id, crowd_report_id) values ($1, $2, 1, 'Bug crowd', $3, $4)`,
      [bug, project, ids.owner, report],
    );
    await pool.query("update crowd_reports set bug_id = $1 where id = $2", [bug, report]);
    await pool.query("insert into crowd_report_links (id, report_id, position, url) values ($1, $2, 0, 'https://e.io')", [
      randomUUID(),
      report,
    ]);
    await pool.query(
      "insert into crowd_report_events (report_id, actor_id, from_status, to_status) values ($1, $2, null, 'submitted')",
      [report, ids.tester],
    );
    await pool.query("insert into crowd_report_comments (id, report_id, author_id, body) values ($1, $2, $3, 'Halo')", [
      randomUUID(),
      report,
      ids.tester,
    ]);
    return { project, cycle, report, bug };
  }

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });

    // 1. DB sampai skema 0006 dengan data Tahap 4 (suite, case manual, bug).
    tmpFolder = await truncatedMigrations(BEFORE_0007);
    await migrate(drizzle(pool, { schema }), { migrationsFolder: tmpFolder });
    await pool.query(
      "insert into users (id, email, name, password_hash) values ($1, 'pemilik@example.test', 'Pemilik', 'x'), ($2, 'tester@example.test', 'Tester', 'x')",
      [ids.owner, ids.tester],
    );
    await pool.query("insert into projects (id, name, slug, created_by, bug_seq, case_seq) values ($1, 'Lama', 'proyek-lama', $2, 1, 1)", [
      ids.project,
      ids.owner,
    ]);
    await pool.query("insert into case_suites (id, project_id, name, position) values ($1, $2, 'Login', 0)", [ids.suite, ids.project]);
    await pool.query(
      `insert into manual_cases (id, project_id, number, suite_id, title, steps, created_by, updated_by)
       values ($1, $2, 1, $3, 'Judul case', '[{"action":"a","expected":"b"}]'::jsonb, $4, $4)`,
      [ids.manualCase, ids.project, ids.suite, ids.owner],
    );
    await pool.query("insert into bugs (id, project_id, number, title, reporter_id) values ($1, $2, 1, 'Bug lama', $3)", [
      ids.bug,
      ids.project,
      ids.owner,
    ]);

    // 2. Terapkan semua migrasi (menambah 0007).
    await runMigrations(drizzle(pool, { schema }));
  });

  afterAll(async () => {
    await closePoolAndDropDatabase(admin, pool, dbName);
    await admin.end();
    await rm(tmpFolder, { recursive: true, force: true });
  });

  it("data Tahap 4 utuh; counter baru = 0; bug lama tanpa asal crowd", async () => {
    const project = await pool.query("select bug_seq, case_seq, cycle_seq, crowd_report_seq from projects where id = $1", [ids.project]);
    expect(project.rows[0]).toEqual({ bug_seq: 1, case_seq: 1, cycle_seq: 0, crowd_report_seq: 0 });
    const bug = await pool.query("select title, crowd_report_id from bugs where id = $1", [ids.bug]);
    expect(bug.rows[0]).toEqual({ title: "Bug lama", crowd_report_id: null });
    const manual = await pool.query("select title from manual_cases where id = $1", [ids.manualCase]);
    expect(manual.rows[0]).toEqual({ title: "Judul case" });
  });

  it("CHECK menolak status, severity, dan alasan yang tidak dikenal", async () => {
    const { cycle, report } = await seedCrowd("Check");
    for (const [sqlText, args, name] of [
      ["update crowd_cycles set status = 'archived' where id = $1", [cycle], "crowd_cycles_status_check"],
      ["update crowd_participants set status = 'banned' where cycle_id = $1", [cycle], "crowd_participants_status_check"],
      ["update crowd_reports set status = 'approved' where id = $1", [report], "crowd_reports_status_check"],
      ["update crowd_reports set suggested_severity = 'trivial' where id = $1", [report], "crowd_reports_suggested_severity_check"],
      ["update crowd_reports set final_severity = 'trivial' where id = $1", [report], "crowd_reports_final_severity_check"],
      ["update crowd_reports set reject_reason = 'boring' where id = $1", [report], "crowd_reports_reject_reason_check"],
    ] as const) {
      const error = await pool.query(sqlText, [...args]).catch((e: unknown) => e);
      expect(pgCode(error), name).toBe("23514");
      expect(pgConstraint(error)).toBe(name);
    }
  });

  it("nomor cycle dan laporan unik per project; lingkungan unik tanpa peka huruf besar/kecil", async () => {
    const { project, cycle } = await seedCrowd("Unik");
    const dupCycle = await pool
      .query(`insert into crowd_cycles (id, project_id, number, title, created_by) values ($1, $2, 1, 'Lain', $3)`, [
        randomUUID(),
        project,
        ids.owner,
      ])
      .catch((e: unknown) => e);
    expect(pgCode(dupCycle)).toBe("23505");
    expect(pgConstraint(dupCycle)).toBe("crowd_cycles_project_number_unique");

    const dupReport = await pool
      .query(
        `insert into crowd_reports (id, project_id, cycle_id, number, reporter_id, title, steps, expected, actual, environment,
                                    suggested_severity)
         values ($1, $2, $3, 1, $4, 'Lain', 'Langkah panjang', 'a', 'b', 'Firefox', 'minor')`,
        [randomUUID(), project, cycle, ids.tester],
      )
      .catch((e: unknown) => e);
    expect(pgCode(dupReport)).toBe("23505");
    expect(pgConstraint(dupReport)).toBe("crowd_reports_project_number_unique");

    const dupEnv = await pool
      .query("insert into crowd_cycle_environments (cycle_id, position, label) values ($1, 1, 'CHROME')", [cycle])
      .catch((e: unknown) => e);
    expect(pgCode(dupEnv)).toBe("23505");
    expect(pgConstraint(dupEnv)).toBe("crowd_cycle_environments_cycle_label_unique");
  });

  it("menghapus laporan mengosongkan bugs.crowd_report_id; menghapus bug mengosongkan crowd_reports.bug_id", async () => {
    const a = await seedCrowd("Hapus laporan");
    await pool.query("delete from crowd_reports where id = $1", [a.report]);
    const bug = await pool.query("select crowd_report_id from bugs where id = $1", [a.bug]);
    expect(bug.rows[0]).toEqual({ crowd_report_id: null });

    const b = await seedCrowd("Hapus bug");
    await pool.query("delete from bugs where id = $1", [b.bug]);
    const report = await pool.query("select bug_id, status from crowd_reports where id = $1", [b.report]);
    expect(report.rows[0]).toEqual({ bug_id: null, status: "submitted" });
  });

  it("menghapus project menghapus semua data crowd-nya", async () => {
    const { project, cycle, report } = await seedCrowd("Hapus project");
    // Bug dan laporan saling menaut (SET NULL dua arah) dan keduanya ikut terhapus bersama project.
    await pool.query("delete from projects where id = $1", [project]);
    const bugs = await pool.query("select 1 from bugs where project_id = $1", [project]);
    expect(bugs.rowCount).toBe(0);
    for (const [table, column, id] of [
      ["crowd_cycles", "id", cycle],
      ["crowd_cycle_links", "cycle_id", cycle],
      ["crowd_cycle_environments", "cycle_id", cycle],
      ["crowd_participants", "cycle_id", cycle],
      ["crowd_reports", "id", report],
      ["crowd_report_links", "report_id", report],
      ["crowd_report_events", "report_id", report],
      ["crowd_report_comments", "report_id", report],
    ] as const) {
      const rows = await pool.query(`select 1 from ${table} where ${column} = $1`, [id]);
      expect(rows.rowCount, table).toBe(0);
    }
  });

  // Pelajaran Tahap 4: FK `ON DELETE CASCADE/SET NULL` tanpa indeks membuat penghapusan memindai seluruh tabel anak.
  it("setiap FK CASCADE/SET NULL di tabel crowd dan bugs.crowd_report_id punya indeks dengan kolom itu di depan", async () => {
    const fks = await pool.query<{ table: string; column: string }>(
      `select c.conrelid::regclass::text as table, a.attname as column
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confdeltype in ('c', 'n') and array_length(c.conkey, 1) = 1
          and (c.conrelid::regclass::text like 'crowd_%' or (c.conrelid::regclass::text = 'bugs' and a.attname = 'crowd_report_id'))`,
    );
    expect(fks.rows.length).toBeGreaterThanOrEqual(12);
    const leading = await pool.query<{ table: string; column: string }>(
      `select i.indrelid::regclass::text as table, a.attname as column
         from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indpred is null`,
    );
    const indexed = new Set(leading.rows.map((r) => `${r.table}.${r.column}`));
    const missing = fks.rows.map((r) => `${r.table}.${r.column}`).filter((key) => !indexed.has(key));
    expect(missing).toEqual([]);
  });
});
