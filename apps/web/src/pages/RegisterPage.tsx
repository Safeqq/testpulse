import { registerBody } from "@testpulse/shared";
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { FormError } from "../components/FormError";
import { FormField } from "../components/FormField";
import { useAuth } from "../lib/auth";
import { focusField, serverErrorToForm, useDocumentTitle, validate } from "../lib/forms";
import { safeNext } from "../lib/navigation";

export function RegisterPage() {
  useDocumentTitle("Daftar");
  const { status, register } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState("");
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

    const parsed = validate(registerBody, { name, email, password });
    if (!parsed.ok) return fail(parsed.fields, null);

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await register(parsed.data);
    } catch (err) {
      const mapped = serverErrorToForm(err, ["name", "email", "password"]);
      fail(mapped.fields, mapped.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="register-title">
      <h1 id="register-title">Buat akun TestPulse</h1>
      <p className="lead">Daftar gratis untuk mulai mengelola hasil test tim Anda.</p>

      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <FormError message={formError} />
        <FormField
          name="name"
          label="Nama"
          autoComplete="name"
          testIdPrefix="register"
          value={name}
          onChange={setName}
          error={fieldErrors.name}
        />
        <FormField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          testIdPrefix="register"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
        />
        <FormField
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="Minimal 8 karakter."
          testIdPrefix="register"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
        />
        <button
          type="submit"
          className="button button-primary button-block"
          disabled={submitting}
          data-testid="register-submit"
        >
          {submitting ? "Memproses…" : "Daftar"}
        </button>
      </form>

      <p className="auth-alt">
        Sudah punya akun? <Link to="/login">Masuk</Link>
      </p>
    </section>
  );
}
