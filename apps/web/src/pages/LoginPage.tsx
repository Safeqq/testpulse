import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { useStore } from "../state";

export function LoginPage() {
  const { setSession } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hanya izinkan redirect ke path internal (mencegah open redirect).
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { token, user } = await api.login(email, password);
      setSession(token, user);
      navigate(target, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Masuk</h1>
      <form className="form" onSubmit={onSubmit} noValidate data-testid="login-form">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p role="alert" className="error" data-testid="login-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} data-testid="login-submit">
          {submitting ? "Memproses…" : "Masuk"}
        </button>
      </form>
    </>
  );
}
