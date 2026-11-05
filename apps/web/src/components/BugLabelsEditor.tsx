import { Loader2, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BugLabelsInput } from "@/components/BugLabelsInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addLabels, normalizeErrorKey, type BugPatch } from "@/lib/bugForm";
import type { SaveResult } from "@/lib/bugSave";

interface BugLabelsEditorProps {
  labels: string[];
  canEdit: boolean;
  onSave: (patch: BugPatch) => Promise<SaveResult>;
}

/** Label bug di panel samping: daftar chip, dengan editor inline (masukan label yang sama dengan formulir) untuk tester/admin. */
export function BugLabelsEditor({ labels, canEdit, onSave }: BugLabelsEditorProps) {
  const editButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draftLabels, setDraftLabels] = useState<string[]>(labels);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  // Fokus mengikuti mode: ke kolom label saat edit dimulai, kembali ke tombol Ubah saat selesai atau dibatalkan.
  useEffect(() => {
    if (editing) editor.current?.querySelector<HTMLInputElement>('input[name="labels"]')?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function open() {
    setDraftLabels(labels);
    setDraft("");
    setError(undefined);
    setEditing(true);
  }

  async function save() {
    if (pending) return;
    // Teks yang belum jadi chip: yang valid ikut tersimpan, yang tidak valid menahan penyimpanan dengan pesannya.
    const merged = addLabels(draftLabels, draft.split(","));
    if (merged.error) {
      setDraftLabels(merged.labels);
      setDraft(merged.rest);
      setError(merged.error);
      editor.current?.querySelector<HTMLInputElement>('input[name="labels"]')?.focus();
      return;
    }
    setError(undefined);
    if (JSON.stringify([...merged.labels].sort()) === JSON.stringify([...labels].sort())) return setEditing(false);
    setPending(true);
    const result = await onSave({ labels: merged.labels });
    setPending(false);
    if (result.ok) return setEditing(false);
    if (!result.conflict) {
      const field = Object.entries(result.fields ?? {}).find(([key]) => normalizeErrorKey(key) === "labels");
      setError(field?.[1] ?? result.message ?? "Gagal menyimpan label");
    }
  }

  return (
    <section aria-labelledby="bug-labels-title" className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="bug-labels-title" className="text-sm font-semibold">
          Label
        </h2>
        {canEdit && !editing ? (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
            size="sm"
            aria-label="Ubah label"
            data-testid="bug-labels-edit"
            onClick={open}
          >
            <Pencil aria-hidden="true" />
            Ubah
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div ref={editor} className="grid min-w-0 gap-3">
          <BugLabelsInput value={draftLabels} onChange={setDraftLabels} draft={draft} onDraftChange={setDraft} error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={save} disabled={pending} data-testid="bug-labels-save">
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Simpan
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending} data-testid="bug-labels-cancel">
              Batal
            </Button>
          </div>
        </div>
      ) : labels.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground" data-testid="bug-labels">
          Belum ada label.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-labelledby="bug-labels-title" data-testid="bug-labels">
          {labels.map((label) => (
            <li key={label} className="max-w-full">
              <Badge variant="secondary" className="max-w-full">
                <span className="min-w-0 truncate">{label}</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
