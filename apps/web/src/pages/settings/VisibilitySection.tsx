import type { ProjectDto, Visibility } from "@testpulse/shared";
import { useId, useState } from "react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/forms";
import { SettingsSection } from "./SettingsSection";

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
  const baseId = useId();
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
    <SettingsSection id="visibility" title="Visibilitas" description="Perubahan langsung disimpan.">
      <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0" disabled={saving}>
        <legend className="sr-only">Siapa yang dapat melihat project</legend>
        {OPTIONS.map((option) => {
          const labelId = `${baseId}-${option.value}-label`;
          const hintId = `${baseId}-${option.value}-hint`;
          return (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent has-[input:checked]:border-primary has-[input:checked]:bg-accent has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-70"
            >
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={project.visibility === option.value}
                onChange={() => void choose(option.value)}
                aria-labelledby={labelId}
                aria-describedby={hintId}
                className="mt-1 size-4 shrink-0 accent-primary"
                data-testid={`visibility-${option.value}`}
              />
              <span className="grid gap-1">
                <span id={labelId} className="text-sm font-semibold">
                  {option.label}
                </span>
                <span id={hintId} className="text-sm text-muted-foreground">
                  {option.effect}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </SettingsSection>
  );
}
