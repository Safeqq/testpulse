import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUser, Product } from "./api";

export interface CartLine {
  productId: number;
  name: string;
  price: number;
  stock: number;
  quantity: number;
}

interface StoreValue {
  cart: CartLine[];
  cartCount: number;
  addToCart(product: Product): void;
  setQuantity(productId: number, quantity: number): void;
  removeFromCart(productId: number): void;
  clearCart(): void;
  token: string | null;
  user: AuthUser | null;
  setSession(token: string, user: AuthUser): void;
  logout(): void;
}

const StoreContext = createContext<StoreValue | null>(null);

const CART_KEY = "shopqa.cart";
const SESSION_KEY = "shopqa.session";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Batas maksimal per item sama dengan validasi di order service (1–10) dan stok yang tersedia. */
export const MAX_QTY_PER_ITEM = 10;
const clampQty = (qty: number, stock: number) => Math.max(1, Math.min(qty, stock, MAX_QTY_PER_ITEM));

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>(() => load(CART_KEY, []));
  const [session, setSessionState] = useState<{ token: string; user: AuthUser } | null>(() => load(SESSION_KEY, null));

  useEffect(() => localStorage.setItem(CART_KEY, JSON.stringify(cart)), [cart]);
  useEffect(() => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }, [session]);

  const value = useMemo<StoreValue>(
    () => ({
      cart,
      cartCount: cart.reduce((n, line) => n + line.quantity, 0),
      addToCart(product) {
        setCart((prev) => {
          const existing = prev.find((l) => l.productId === product.id);
          if (existing) {
            return prev.map((l) =>
              l.productId === product.id ? { ...l, stock: product.stock, quantity: clampQty(l.quantity + 1, product.stock) } : l,
            );
          }
          return [...prev, { productId: product.id, name: product.name, price: product.price, stock: product.stock, quantity: 1 }];
        });
      },
      setQuantity(productId, quantity) {
        setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity: clampQty(quantity, l.stock) } : l)));
      },
      removeFromCart(productId) {
        setCart((prev) => prev.filter((l) => l.productId !== productId));
      },
      clearCart() {
        setCart([]);
      },
      token: session?.token ?? null,
      user: session?.user ?? null,
      setSession(token, user) {
        setSessionState({ token, user });
      },
      logout() {
        setSessionState(null);
      },
    }),
    [cart, session],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore harus dipakai di dalam <StoreProvider>");
  return ctx;
}
