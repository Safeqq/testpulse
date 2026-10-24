import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

function Header() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout() {
    setLogoutError(null);
    try {
      await logout();
      navigate("/login");
    } catch {
      setLogoutError("Gagal keluar. Coba lagi.");
    }
  }

  return (
    <header className="app-header">
      <a className="skip-link" href="#main">
        Lewati ke konten utama
      </a>
      <div className="app-header-inner">
        <Link to="/" className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <path
              d="M4 17h6l3-8 5 15 3-7h7"
              fill="none"
              stroke="#fff"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>TestPulse</span>
        </Link>

        <nav aria-label="Navigasi utama" className="main-nav">
          {status === "authenticated" && user ? (
            <>
              <NavLink to="/" end>
                Project saya
              </NavLink>
              <span className="nav-sep" aria-hidden="true" />
              <span className="current-user" data-testid="current-user">
                {user.name}
              </span>
              <button type="button" className="button button-secondary" data-testid="logout" onClick={handleLogout}>
                Keluar
              </button>
            </>
          ) : status === "anonymous" ? (
            <>
              <NavLink to="/login">Masuk</NavLink>
              <NavLink to="/register" className="button button-primary">
                Daftar
              </NavLink>
            </>
          ) : null}
        </nav>
      </div>
      <div role="alert" className={logoutError ? "header-error" : undefined}>
        {logoutError}
      </div>
    </header>
  );
}

export function Layout() {
  return (
    <>
      <Header />
      <main id="main" tabIndex={-1} className="app-main">
        <Outlet />
      </main>
    </>
  );
}
