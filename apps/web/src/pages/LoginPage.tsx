import { loginBody } from "@testpulse/shared";
import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { FormError } from "../components/FormError";
import { FormField } from "../components/FormField";
import { useAuth } from "../lib/auth";
import { focusField, serverErrorToForm, useDocumentTitle, validate } from "../lib/forms";
import { registerPathFor, safeNext } from "../lib/navigation";

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
    <section className="mx-auto w-full max-w-md py-4 md:py-10" aria-labelledby="login-title">
      <Card>
        <CardHeader className="items-center text-center">
          <BrandMark size={40} />
          <h1 id="login-title" className="mt-2 text-2xl font-semibold tracking-tight">
            Masuk ke TestPulse
          </h1>
          <CardDescription>Masuk untuk melihat dan mengelola project test Anda.</CardDescription>
        </CardHeader>

        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            <FormError message={formError} />
            <div className="grid gap-4">
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
              <Button type="submit" size="lg" className="w-full" disabled={submitting} data-testid="login-submit">
                {submitting ? "Memproses…" : "Masuk"}
              </Button>
            </div>
          </form>
        </CardContent>

        <CardFooter className="justify-center text-sm text-muted-foreground">
          <p>
            Belum punya akun?{" "}
            <Link
              to={registerPathFor(next)}
              className="rounded-sm font-medium text-link underline underline-offset-4 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              Daftar sekarang
            </Link>
          </p>
        </CardFooter>
      </Card>
    </section>
  );
}
