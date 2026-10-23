import type { Pool } from "./db.js";
import type { Totals } from "./pricing.js";

export interface User {
  id: number;
  email: string;
  name: string;
  passwordHash: string;
}

export interface OrderItem {
  productId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export type OrderStatus = "CONFIRMED";

export interface Order extends Totals {
  id: number;
  userId: number;
  status: OrderStatus;
  promoCode: string | null;
  items: OrderItem[];
  createdAt: string;
}

export interface NewOrder extends Totals {
  userId: number;
  promoCode: string | null;
  items: Omit<OrderItem, "lineTotal">[];
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
}

export interface OrderRepository {
  create(order: NewOrder): Promise<Order>;
  findById(id: number): Promise<Order | null>;
  listByUser(userId: number): Promise<Order[]>;
}

export function createUserRepository(pool: Pool): UserRepository {
  return {
    async findByEmail(email) {
      const { rows } = await pool.query<{ id: number; email: string; name: string; password_hash: string }>(
        "SELECT id, email, name, password_hash FROM users WHERE email = $1",
        [email.toLowerCase()],
      );
      const row = rows[0];
      return row ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash } : null;
    },
  };
}

interface OrderRow {
  id: number;
  user_id: number;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  promo_code: string | null;
  created_at: Date;
}

interface OrderItemRow {
  order_id: number;
  product_id: number;
  product_name: string;
  unit_price: number;
  quantity: number;
}

const toOrder = (row: OrderRow, items: OrderItemRow[]): Order => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  subtotal: row.subtotal,
  discount: row.discount,
  shipping: row.shipping,
  total: row.total,
  promoCode: row.promo_code,
  createdAt: row.created_at.toISOString(),
  items: items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
    unitPrice: item.unit_price,
    quantity: item.quantity,
    lineTotal: item.unit_price * item.quantity,
  })),
});

export function createOrderRepository(pool: Pool): OrderRepository {
  const loadItems = async (orderIds: number[]) => {
    const { rows } = await pool.query<OrderItemRow>(
      "SELECT order_id, product_id, product_name, unit_price, quantity FROM order_items WHERE order_id = ANY($1) ORDER BY id",
      [orderIds],
    );
    return rows;
  };

  const repo: OrderRepository = {
    async create(order) {
      const client = await pool.connect();
      let orderId: number;
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO orders (user_id, status, subtotal, discount, shipping, total, promo_code)
           VALUES ($1, 'CONFIRMED', $2, $3, $4, $5, $6) RETURNING id`,
          [order.userId, order.subtotal, order.discount, order.shipping, order.total, order.promoCode],
        );
        orderId = rows[0]!.id;
        for (const item of order.items) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
             VALUES ($1, $2, $3, $4, $5)`,
            [orderId, item.productId, item.productName, item.unitPrice, item.quantity],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return (await repo.findById(orderId))!;
    },

    async findById(id) {
      const { rows } = await pool.query<OrderRow>("SELECT * FROM orders WHERE id = $1", [id]);
      if (!rows[0]) return null;
      return toOrder(rows[0], await loadItems([id]));
    },

    async listByUser(userId) {
      const { rows } = await pool.query<OrderRow>("SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC", [userId]);
      if (rows.length === 0) return [];
      const items = await loadItems(rows.map((r) => r.id));
      return rows.map((row) => toOrder(row, items.filter((i) => i.order_id === row.id)));
    },
  };
  return repo;
}
