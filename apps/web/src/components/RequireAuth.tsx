import { useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { loginPathFor } from "../lib/navigation";

/**
 * Melindungi halaman: anonim diarahkan ke `/login?next=<path>` (hanya jalur internal). Bisa dipakai sebagai pembungkus atau route layout.
 * Jika user keluar saat berada di halaman ini, tujuannya `/login` polos (tidak ada halaman untuk kembali setelah logout).
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  const [wasAuthenticated, setWasAuthenticated] = useState(false);

  if (status === "authenticated" && !wasAuthenticated) setWasAuthenticated(true);

  if (status === "loading") {
    return (
      <p role="status" className="loading">
        Memuat…
      </p>
    );
  }
  if (status === "anonymous") {
    return <Navigate to={wasAuthenticated ? "/login" : loginPathFor(location.pathname + location.search)} replace />;
  }
  return children ?? <Outlet />;
}
