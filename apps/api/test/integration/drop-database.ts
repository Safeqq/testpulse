import type pg from "pg";

/**
 * Menutup `pool` lalu menghapus database sementara test migrasi.
 *
 * `pool.end()` bisa selesai sebelum server Postgres benar-benar melepas koneksinya. `drop database ... with (force)`
 * lalu memutus koneksi itu, dan pg melemparkan "terminating connection due to administrator command" sebagai
 * unhandled error yang membuat Vitest menggagalkan run (terlihat di CI). Karena itu error pool diabaikan, dan drop
 * menunggu sampai tidak ada koneksi lain ke database tersebut (maks. 5 detik) sebelum memaksa.
 */
export async function closePoolAndDropDatabase(admin: pg.Pool, pool: pg.Pool, dbName: string): Promise<void> {
  pool.on("error", () => undefined);
  await pool.end();
  for (let i = 0; i < 50; i++) {
    const { rows } = await admin.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [dbName],
    );
    if (rows[0]?.n === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await admin.query(`drop database if exists ${dbName} with (force)`);
}
