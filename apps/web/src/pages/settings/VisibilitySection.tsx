import type { ProjectDto, Visibility } from "@testpulse/shared";
import { useState } from "react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/forms";

interface Props {
  project: ProjectDto;
  onSaved: (project: ProjectDto) => void;
  notify: (message: string) => void;
}

const OPTIONS: ReadonlyArray<{ value: Visibility; label: string; effect: string }> = [
  {
    value: "private",
    label: "Privat",
    effect: "Hanya anggota project yang dapat membuka project dan hasil testnya. Orang lain melihat halaman “tidak ditemukan”.",
  },
  {
    value: "public",
    label: "Publik",
    effect:
      "Siapa pun yang memiliki tautan dapat melihat ringkasan dan hasil test secara hanya-baca, tanpa perlu masuk. Pengaturan, anggota, dan undangan tetap hanya untuk anggota.",
  },
];

/** Pilihan privat/publik; perubahan langsung disimpan (admin). */
export function VisibilitySection({ project, onSaved, notify }: Props) {
  const [saving, setSaving] = useState(false);

  async function choose(visibility: Visibility) {
    if (saving || visibility === project.visibility) return;
    setSaving(true);
    try {
      const updated = await api.projects.update(project.slug, { visibility });
      onSaved(updated);
      notify(visibility === "public" ? "Visibilitas diubah menjadi publik." : "Visibilitas diubah menjadi privat.");
    } catch (err) {
      notify(errorMessage(err, "Gagal mengubah visibilitas. Coba lagi."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="visibility-title">
      <h2 id="visibility-title">Visibilitas</h2>
      <fieldset className="choice-group" disabled={saving}>
        <legend className="visually-hidden">Siapa yang dapat melihat project</legend>
        {OPTIONS.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name="visibility"
              value={option.value}
              checked={project.visibility === option.value}
              onChange={() => void choose(option.value)}
              data-testid={`visibility-${option.value}`}
            />
            <span>
              <span className="choice-label">{option.label}</span>
              <span className="choice-hint">{option.effect}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
