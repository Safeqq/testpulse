import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

/** `Db` atau transaksi di dalamnya: cukup untuk menjalankan query (repository baca menerima keduanya). */
export type Queryable = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  // Error pada koneksi idle tidak boleh menjatuhkan proses.
  pool.on("error", () => {});
  return { db: drizzle(pool, { schema }), pool };
}

/** SQLSTATE `query_canceled`: Postgres membatalkan statement, mis. karena `statement_timeout`. */
const QUERY_CANCELED = "57014";

/**
 * Menjalankan `fn` dalam transaksi baca-saja (REPEATABLE READ: semua query melihat snapshot yang sama) dengan
 * `statement_timeout` lokal transaksi, sehingga query baca yang terlalu berat dibatalkan Postgres alih-alih
 * menahan koneksi pool. Pembatalan muncul sebagai error 57014 (lihat `isStatementTimeout`).
 */
export async function withStatementTimeout<T>(db: Db, timeoutMs: number, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(
    async (tx) => {
      // `SET LOCAL` tidak menerima parameter; `set_config(…, true)` setara dan aman diparameterkan.
      await tx.execute(sql`select set_config('statement_timeout', ${`${Math.trunc(timeoutMs)}ms`}, true)`);
      return fn(tx);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Error dari Postgres (langsung, atau dibungkus drizzle sebagai `cause`) karena statement dibatalkan. */
export function isStatementTimeout(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 3; depth += 1) {
    if (typeof current !== "object") return false;
    if ("code" in current && current.code === QUERY_CANCELED) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
