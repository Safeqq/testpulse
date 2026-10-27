import { Menu, X } from "lucide-react";
import { useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const MENU_ID = "site-menu";

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none",
    isActive ? "text-foreground" : "text-muted-foreground",
  );
}

function Header() {
  const { user, status, logout, retry } = useAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);

  async function handleLogout() {
    setLogoutError(null);
    try {
      await logout();
      setMenuOpen(false);
      navigate("/login");
    } catch {
      setLogoutError("Gagal keluar. Coba lagi.");
    }
  }

  // Escape menutup menu mobile dan mengembalikan fokus ke tombolnya.
  function handleMenuKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && menuOpen) {
      setMenuOpen(false);
      menuToggleRef.current?.focus();
    }
  }

  // Memilih tautan menutup menu mobile.
  function handleMenuClick(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest("a")) setMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-card text-card-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Lewati ke konten utama
      </a>
      {/* Satu struktur DOM untuk desktop dan mobile: di < md panel menu disembunyikan (display: none, sehingga keluar
          dari pohon aksesibilitas) sampai tombol disclosure dibuka. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md text-lg font-semibold tracking-tight text-foreground no-underline hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <BrandMark />
          <span>TestPulse</span>
        </Link>

        <div className="ml-auto flex items-center gap-1 md:order-3 md:ml-0">
          <ThemeToggle />
          <Button
            ref={menuToggleRef}
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Menu navigasi"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            data-testid="mobile-menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={handleMenuKeyDown}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>

        <div
          id={MENU_ID}
          className={cn(
            "w-full min-w-0 flex-col gap-3 pb-2 md:order-2 md:flex md:w-auto md:flex-1 md:flex-row md:items-center md:justify-between md:pb-0",
            menuOpen ? "flex" : "hidden",
          )}
          onKeyDown={handleMenuKeyDown}
          onClick={handleMenuClick}
        >
          <nav aria-label="Navigasi utama" className="flex flex-col md:flex-row md:items-center md:gap-1">
            {status === "authenticated" && user ? (
              <NavLink to="/" end className={navLinkClass}>
                Project saya
              </NavLink>
            ) : null}
          </nav>

          {status === "authenticated" && user ? (
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground md:max-w-[16rem] md:flex-none"
                data-testid="current-user"
                title={user.name}
              >
                {user.name}
              </span>
              <Button type="button" variant="outline" size="sm" data-testid="logout" onClick={handleLogout}>
                Keluar
              </Button>
            </div>
          ) : status === "anonymous" ? (
            <div className="flex items-center gap-2">
              <NavLink to="/login" className={navLinkClass}>
                Masuk
              </NavLink>
              <Button asChild size="sm">
                <Link to="/register">Daftar</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <div
        role="alert"
        className={logoutError ? "border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive" : undefined}
      >
        {logoutError}
      </div>
      {status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          data-testid="auth-error"
        >
          Sesi Anda belum dapat diperiksa karena server tidak merespons.
          <Button type="button" variant="outline" size="sm" data-testid="auth-retry" onClick={retry}>
            Coba lagi
          </Button>
        </div>
      ) : null}
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
