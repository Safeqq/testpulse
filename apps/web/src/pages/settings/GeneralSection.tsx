import { updateProjectBody, type ProjectDto } from "@testpulse/shared";
import { useRef, useState, type FormEvent } from "react";
import { FormError } from "../../components/FormError";
import { FormField } from "../../components/FormField";
import { api } from "../../lib/api";
import { focusField, serverErrorToForm, validate } from "../../lib/forms";

interface Props {
  project: ProjectDto;
  onSaved: (project: ProjectDto) => void;
  notify: (message: string) => void;
}

/** Ganti nama project (admin). Slug tidak berubah agar tautan tetap berlaku. */
export function GeneralSection({ project, onSaved, notify }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(project.name);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    const parsed = validate(updateProjectBody, { name });
    if (!parsed.ok) return fail(parsed.fields, null);

    setFieldErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const updated = await api.projects.update(project.slug, parsed.data);
      onSaved(updated);
      setName(updated.name);
      notify("Nama project disimpan.");
    } catch (err) {
      const mapped = serverErrorToForm(err, ["name"]);
      fail(mapped.fields, mapped.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="general-title">
      <h2 id="general-title">Umum</h2>
      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={saving}>
        <FormError message={formError} />
        <FormField
          name="name"
          label="Nama project"
          testIdPrefix="settings"
          hint={`Alamat project tetap /p/${project.slug}.`}
          value={name}
          onChange={setName}
          error={fieldErrors.name}
        />
        <button type="submit" className="button button-primary" disabled={saving} data-testid="settings-save">
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </form>
    </section>
  );
}
