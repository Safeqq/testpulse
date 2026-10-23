import pg from "pg";

export type Pool = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price >= 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  image_url   TEXT NOT NULL DEFAULT ''
);
`;

// Harga dalam rupiah (integer) agar tidak ada masalah pembulatan floating point.
const SEED_PRODUCTS = [
  ["KB-001", "Keyboard Mekanikal", "Keyboard 75% dengan switch tactile.", 650_000, 25],
  ["MS-002", "Mouse Wireless", "Mouse ergonomis 2.4GHz + Bluetooth.", 185_000, 40],
  ["HS-003", "Headset Gaming", "Headset over-ear dengan mikrofon noise-cancelling.", 420_000, 15],
  ["MN-004", "Monitor 24 inci", "Panel IPS 1080p 75Hz.", 1_850_000, 8],
  ["WC-005", "Webcam HD", "Webcam 1080p dengan autofocus.", 275_000, 30],
  ["UB-006", "USB Hub 4 Port", "Hub USB 3.0 aluminium.", 95_000, 0],
] as const;

export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA);
  const { rows } = await pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM products");
  if (Number(rows[0]?.count) > 0) return;

  for (const [sku, name, description, price, stock] of SEED_PRODUCTS) {
    await pool.query(
      `INSERT INTO products (sku, name, description, price, stock, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sku, name, description, price, stock, `/images/${sku.toLowerCase()}.svg`],
    );
  }
}
