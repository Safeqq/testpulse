import { registerBody } from "@testpulse/shared";
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { FormError } from "../components/FormError";
import { FormField } from "../components/FormField";
import { useAuth } from "../lib/auth";
import { focusField, serverErrorToForm, useDocumentTitle, validate } from "../lib/forms";
import { loginPathFor, safeNext } from "../lib/navigation";

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
    <section className="mx-auto w-full max-w-md py-4 md:py-10" aria-labelledby="register-title">
      <Card>
        <CardHeader className="items-center text-center">
          <BrandMark size={40} />
          <h1 id="register-title" className="mt-2 text-2xl font-semibold tracking-tight">
            Buat akun TestPulse
          </h1>
          <CardDescription>Daftar gratis untuk mulai mengelola hasil test tim Anda.</CardDescription>
        </CardHeader>

        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            <FormError message={formError} />
            <div className="grid gap-4">
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
              <Button type="submit" size="lg" className="w-full" disabled={submitting} data-testid="register-submit">
                {submitting ? "Memproses…" : "Daftar"}
              </Button>
            </div>
          </form>
        </CardContent>

        <CardFooter className="justify-center text-sm text-muted-foreground">
          <p>
            Sudah punya akun?{" "}
            <Link
              to={loginPathFor(next)}
              className="rounded-sm font-medium text-link underline underline-offset-4 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden"
            >
              Masuk
            </Link>
          </p>
        </CardFooter>
      </Card>
    </section>
  );
}
