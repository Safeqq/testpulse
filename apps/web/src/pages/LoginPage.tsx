import { loginBody } from "@testpulse/shared";
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { FormError } from "../components/FormError";
import { FormField } from "../components/FormField";
import { useAuth } from "../lib/auth";
import { focusField, serverErrorToForm, useDocumentTitle, validate } from "../lib/forms";
import { safeNext } from "../lib/navigation";

export function LoginPage() {
  useDocumentTitle("Masuk");
  const { status, login } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const formRef = useRef<HTMLFormElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") return <Navigate to={next} replace />;

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const parsed = validate(loginBody, { email, password });
    if (!parsed.ok) return fail(parsed.fields, null);

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await login(parsed.data);
    } catch (err) {
      const mapped = serverErrorToForm(err, ["email", "password"]);
      fail(mapped.fields, mapped.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <h1 id="login-title">Masuk ke TestPulse</h1>
      <p className="lead">Masuk untuk melihat dan mengelola project test Anda.</p>

      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <FormError message={formError} />
        <FormField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          testIdPrefix="login"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
        />
        <FormField
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          testIdPrefix="login"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
        />
        <button type="submit" className="button button-primary button-block" disabled={submitting} data-testid="login-submit">
          {submitting ? "Memproses…" : "Masuk"}
        </button>
      </form>

      <p className="auth-alt">
        Belum punya akun? <Link to="/register">Daftar sekarang</Link>
      </p>
    </section>
  );
}
