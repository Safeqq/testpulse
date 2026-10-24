import type { LoginBody, RegisterBody, UserDto } from "@testpulse/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type ApiClient } from "./api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthState {
  user: UserDto | null;
  status: AuthStatus;
}

export interface AuthContextValue extends AuthState {
  login(body: LoginBody): Promise<UserDto>;
  register(body: RegisterBody): Promise<UserDto>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, client = api }: { children: ReactNode; client?: ApiClient }) {
  const [state, setState] = useState<AuthState>({ user: null, status: "loading" });

  useEffect(() => {
    let active = true;
    // Hasil awal /me hanya dipakai jika belum ada login/daftar yang selesai lebih dulu.
    const apply = (next: AuthState) => {
      if (active) setState((prev) => (prev.status === "loading" ? next : prev));
    };
    client.auth.me().then(
      (user) => apply({ user, status: "authenticated" }),
      () => apply({ user: null, status: "anonymous" }),
    );
    return () => {
      active = false;
    };
  }, [client]);

  const login = useCallback(
    async (body: LoginBody) => {
      const user = await client.auth.login(body);
      setState({ user, status: "authenticated" });
      return user;
    },
    [client],
  );

  const register = useCallback(
    async (body: RegisterBody) => {
      const user = await client.auth.register(body);
      setState({ user, status: "authenticated" });
      return user;
    },
    [client],
  );

  const logout = useCallback(async () => {
    try {
      await client.auth.logout();
    } catch (err) {
      // Sesi sudah tidak berlaku di server: anggap keluar berhasil.
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
    setState({ user: null, status: "anonymous" });
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout }),
    [state, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}
