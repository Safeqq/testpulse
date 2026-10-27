import { createProjectBody, slugify, slugSchema } from "@testpulse/shared";
import { ArrowLeft } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { FormError } from "../components/FormError";
import { FormField } from "../components/FormField";
import { ApiError, api } from "../lib/api";
import { focusField, serverErrorToForm, useDocumentTitle, validate } from "../lib/forms";

const MANUAL_SLUG_MESSAGE = "Slug tidak dapat dibuat dari nama ini, isi slug secara manual";
const FIELDS = ["name", "slug"] as const;

export function NewProjectPage() {
  useDocumentTitle("Buat project");
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const typedSlug = slug.trim();
  const effectiveSlug = typedSlug || slugify(name);

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const parsed = validate(createProjectBody, { name, slug: typedSlug || undefined });
    if (!parsed.ok) return fail(parsed.fields, null);
    // Slug otomatis harus lolos aturan yang sama dengan slug manual (mis. nama non-latin menghasilkan slug kosong).
    if (!typedSlug && !slugSchema.safeParse(effectiveSlug).success) {
      return fail({ slug: MANUAL_SLUG_MESSAGE }, null);
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const project = await api.projects.create(parsed.data);
      navigate(`/p/${project.slug}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SLUG_TAKEN") fail({ slug: err.message }, null);
      else {
        const mapped = serverErrorToForm(err, FIELDS);
        fail(mapped.fields, mapped.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-lg grid-cols-1 gap-4 py-2 md:py-6" aria-labelledby="new-project-title">
      <Card>
        <CardHeader>
          <h1 id="new-project-title" className="text-2xl font-semibold tracking-tight">
            Buat project
          </h1>
          <CardDescription>Beri nama project Anda. Slug dibuat otomatis dari nama, atau isi sendiri.</CardDescription>
        </CardHeader>

        <CardContent>
          <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            <FormError message={formError} />
            <div className="grid gap-4">
              <FormField
                name="name"
                label="Nama project"
                testIdPrefix="project"
                value={name}
                onChange={setName}
                error={fieldErrors.name}
              />
              <FormField
                name="slug"
                label="Slug (opsional)"
                testIdPrefix="project"
                hint="Huruf kecil, angka, dan tanda hubung; 3–40 karakter. Kosongkan untuk membuatnya dari nama."
                value={slug}
                onChange={setSlug}
                error={fieldErrors.slug}
              />
              <p className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                Alamat project:{" "}
                <span className="font-mono break-all">
                  <span>/p/</span>
                  <code className="font-semibold text-foreground" data-testid="slug-preview">
                    {effectiveSlug || "…"}
                  </code>
                </span>
              </p>
              <Button type="submit" size="lg" className="w-full" disabled={submitting} data-testid="create-project-submit">
                {submitting ? "Memproses…" : "Buat project"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Link
        to="/"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-link underline underline-offset-4 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Kembali ke project saya
      </Link>
    </section>
  );
}
