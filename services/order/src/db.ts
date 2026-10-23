import pg from "pg";
import { hashPassword } from "./passwords.js";

export type Pool = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL,
  subtotal   INTEGER NOT NULL,
  discount   INTEGER NOT NULL,
  shipping   INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  promo_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price   INTEGER NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0)
);
`;

// Akun demo untuk development & test otomatis. Dua user dibutuhkan untuk menguji
// otorisasi (user A tidak boleh melihat pesanan user B).
export const SEED_USERS = [
  { email: "demo@shopqa.dev", name: "Pengguna Demo", password: "Demo123!" },
  { email: "qa@shopqa.dev", name: "Tester QA", password: "Qa12345!" },
] as const;

export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA);
  for (const user of SEED_USERS) {
    await pool.query(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
      [user.email, user.name, await hashPassword(user.password)],
    );
  }
}
