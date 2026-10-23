import type { Pool } from "./db.js";

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
}

export type StockChangeResult =
  | { status: "ok"; remainingStock: number }
  | { status: "not_found" }
  | { status: "insufficient_stock"; availableStock: number };

export interface ProductRepository {
  list(): Promise<Product[]>;
  findById(id: number): Promise<Product | null>;
  reserve(id: number, quantity: number): Promise<StockChangeResult>;
  release(id: number, quantity: number): Promise<StockChangeResult>;
}

interface ProductRow {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  image_url: string;
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  description: row.description,
  price: row.price,
  stock: row.stock,
  imageUrl: row.image_url,
});

export function createProductRepository(pool: Pool): ProductRepository {
  return {
    async list() {
      const { rows } = await pool.query<ProductRow>("SELECT * FROM products ORDER BY id");
      return rows.map(toProduct);
    },

    async findById(id) {
      const { rows } = await pool.query<ProductRow>("SELECT * FROM products WHERE id = $1", [id]);
      return rows[0] ? toProduct(rows[0]) : null;
    },

    async reserve(id, quantity) {
      // Satu UPDATE atomik dengan kondisi stock >= quantity mencegah overselling
      // saat ada request paralel (tidak perlu SELECT lalu UPDATE).
      const { rows } = await pool.query<{ stock: number }>(
        "UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING stock",
        [id, quantity],
      );
      if (rows[0]) return { status: "ok", remainingStock: rows[0].stock };

      const product = await this.findById(id);
      if (!product) return { status: "not_found" };
      return { status: "insufficient_stock", availableStock: product.stock };
    },

    async release(id, quantity) {
      const { rows } = await pool.query<{ stock: number }>(
        "UPDATE products SET stock = stock + $2 WHERE id = $1 RETURNING stock",
        [id, quantity],
      );
      return rows[0] ? { status: "ok", remainingStock: rows[0].stock } : { status: "not_found" };
    },
  };
}
