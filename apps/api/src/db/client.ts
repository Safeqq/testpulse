import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  // Error pada koneksi idle tidak boleh menjatuhkan proses.
  pool.on("error", () => {});
  return { db: drizzle(pool, { schema }), pool };
}
