import type { ProjectDto } from "@testpulse/shared";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FormError } from "../../components/FormError";
import { FormField } from "../../components/FormField";
import { api } from "../../lib/api";
import { serverErrorToForm } from "../../lib/forms";
import { SettingsSection } from "./SettingsSection";

/** Hapus project permanen (admin); tombol aktif hanya jika slug diketik persis. */
export function DangerZone({ project }: { project: ProjectDto }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (deleting || confirm !== project.slug) return;
    setError(null);
    setDeleting(true);
    try {
      await api.projects.remove(project.slug, { confirmSlug: confirm });
      navigate("/");
    } catch (err) {
      setError(serverErrorToForm(err, []).message);
      setDeleting(false);
    }
  }

  return (
    <SettingsSection
      id="danger"
      title="Zona berbahaya"
      tone="danger"
      description="Menghapus project menghapus semua anggota dan undangannya secara permanen. Tindakan ini tidak dapat dibatalkan."
    >
      <form onSubmit={handleSubmit} noValidate aria-busy={deleting}>
        <FormError message={error} />
        <div className="grid gap-4">
          <FormField
            name="confirm"
            label="Ketik slug project untuk mengonfirmasi"
            testIdPrefix="delete"
            autoComplete="off"
            hint={`Ketik ${project.slug} persis seperti itu.`}
            value={confirm}
            onChange={setConfirm}
          />
          <div>
            <Button
              type="submit"
              variant="destructive"
              disabled={deleting || confirm !== project.slug}
              data-testid="delete-project"
            >
              {deleting ? "Menghapus…" : "Hapus project"}
            </Button>
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}
