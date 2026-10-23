export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
}

export interface OrderLine {
  productId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

export interface Quote extends Totals {
  items: OrderLine[];
  promoCode: string | null;
}

export interface Order extends Totals {
  id: number;
  status: string;
  promoCode: string | null;
  items: OrderLine[];
  createdAt: string;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

export interface CartItemInput {
  productId: number;
  quantity: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? "UNKNOWN_ERROR", body?.message ?? `Permintaan gagal (HTTP ${res.status})`);
  }
  return body as T;
}

export const api = {
  listProducts: () => request<Product[]>("/api/catalog/products"),

  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/api/order/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  quote: (items: CartItemInput[], promoCode?: string) =>
    request<Quote>("/api/order/orders/quote", { method: "POST", body: JSON.stringify({ items, promoCode }) }),

  createOrder: (token: string, items: CartItemInput[], promoCode?: string) =>
    request<Order>("/api/order/orders", { method: "POST", token, body: JSON.stringify({ items, promoCode }) }),

  getOrder: (token: string, id: string) => request<Order>(`/api/order/orders/${id}`, { token }),

  listOrders: (token: string) => request<Order[]>("/api/order/orders", { token }),
};

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
export const formatRupiah = (value: number) => rupiah.format(value);
