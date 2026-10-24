import { createProjectBody, slugify, slugSchema } from "@testpulse/shared";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
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
    <section className="auth-card" aria-labelledby="new-project-title">
      <h1 id="new-project-title">Buat project</h1>
      <p className="lead">Beri nama project Anda. Slug dibuat otomatis dari nama, atau isi sendiri.</p>

      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <FormError message={formError} />
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
        <p className="slug-preview">
          Alamat project: <span className="slug-preview-path">/p/</span>
          <code data-testid="slug-preview">{effectiveSlug || "…"}</code>
        </p>
        <button
          type="submit"
          className="button button-primary button-block"
          disabled={submitting}
          data-testid="create-project-submit"
        >
          {submitting ? "Memproses…" : "Buat project"}
        </button>
      </form>

      <p className="auth-alt">
        <Link to="/">Kembali ke project saya</Link>
      </p>
    </section>
  );
}
