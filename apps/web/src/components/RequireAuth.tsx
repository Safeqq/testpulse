import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { loginPathFor } from "../lib/navigation";

/** Melindungi halaman: anonim diarahkan ke `/login?next=<path>` (hanya jalur internal). Bisa dipakai sebagai pembungkus atau route layout. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <p role="status" className="loading">
        Memuat…
      </p>
    );
  }
  if (status === "anonymous") {
    return <Navigate to={loginPathFor(location.pathname + location.search)} replace />;
  }
  return children ?? <Outlet />;
}
