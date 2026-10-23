import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router";
import { CartPage } from "./pages/CartPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderPage } from "./pages/OrderPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ProductsPage } from "./pages/ProductsPage";
import { useStore } from "./state";

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useStore();
  const location = useLocation();
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

export function App() {
  const { cartCount, user, logout } = useStore();

  return (
    <>
      <header className="header">
        <Link to="/" className="brand">
          ShopQA
        </Link>
        <nav aria-label="Navigasi utama">
          <NavLink to="/" end>
            Produk
          </NavLink>
          <NavLink to="/cart" data-testid="nav-cart">
            Keranjang <span className="badge" data-testid="cart-count">{cartCount}</span>
          </NavLink>
          {user && <NavLink to="/orders">Pesanan Saya</NavLink>}
          {user ? (
            <>
              <span className="user" data-testid="current-user">
                {user.name}
              </span>
              <button type="button" className="link-button" onClick={logout} data-testid="logout">
                Keluar
              </button>
            </>
          ) : (
            <NavLink to="/login" data-testid="nav-login">
              Masuk
            </NavLink>
          )}
        </nav>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<ProductsPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/checkout"
            element={
              <RequireAuth>
                <CheckoutPage />
              </RequireAuth>
            }
          />
          <Route
            path="/orders"
            element={
              <RequireAuth>
                <OrdersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <RequireAuth>
                <OrderPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<h1>Halaman tidak ditemukan</h1>} />
        </Routes>
      </main>
    </>
  );
}
