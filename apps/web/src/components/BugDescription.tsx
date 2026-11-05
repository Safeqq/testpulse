import { Loader2, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { LazyMarkdown } from "@/components/LazyMarkdown";
import { MarkdownEditor, type EditorMode } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { validateBugPatch, type BugPatch } from "@/lib/bugForm";
import type { SaveResult } from "@/lib/bugSave";

interface BugDescriptionProps {
  description: string;
  canEdit: boolean;
  onSave: (patch: BugPatch) => Promise<SaveResult>;
}

/** Deskripsi bug (Markdown aman) dengan edit inline untuk tester/admin; editornya sama dengan formulir bug baru. */
export function BugDescription({ description, canEdit, onSave }: BugDescriptionProps) {
  const form = useRef<HTMLFormElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const [mode, setMode] = useState<EditorMode>("write");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Fokus mengikuti mode: ke kolom teks saat edit dimulai, kembali ke tombol Ubah saat selesai atau dibatalkan.
  useEffect(() => {
    if (editing) form.current?.querySelector("textarea")?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function open() {
    setDraft(description);
    setMode("write");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function fail(message: string) {
    setError(message);
    // Kolom teks tersembunyi saat Pratinjau: kembali ke Tulis (sinkron) sebelum memindahkan fokus.
    flushSync(() => setMode("write"));
    form.current?.querySelector("textarea")?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const validated = validateBugPatch({ description: draft });
    if (!validated.ok) return fail(validated.fields.description ?? "Deskripsi tidak valid");
    if (validated.patch.description === description) return cancel();
    setPending(true);
    const result = await onSave(validated.patch);
    setPending(false);
    if (result.ok) return setEditing(false);
    if (!result.conflict) fail(result.fields?.description ?? result.message ?? "Gagal menyimpan deskripsi");
  }

  return (
    <section aria-labelledby="bug-description-title" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bug-description-title" className="text-lg font-semibold tracking-tight">
          Deskripsi
        </h2>
        {canEdit && !editing ? (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
            size="sm"
            aria-label="Ubah deskripsi"
            data-testid="bug-description-edit"
            onClick={open}
          >
            <Pencil aria-hidden="true" />
            Ubah
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form ref={form} onSubmit={submit} noValidate className="grid min-w-0 gap-3">
          <MarkdownEditor
            name="description"
            label="Deskripsi"
            value={draft}
            onChange={setDraft}
            error={error ?? undefined}
            mode={mode}
            onModeChange={setMode}
            hint="Mendukung Markdown. Boleh dikosongkan."
            testId="bug-description-input"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending} data-testid="bug-description-save">
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Simpan
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={cancel} disabled={pending} data-testid="bug-description-cancel">
              Batal
            </Button>
          </div>
        </form>
      ) : (
        <div className="min-w-0" data-testid="bug-description">
          {description.trim() === "" ? (
            <p className="m-0 text-sm text-muted-foreground">Belum ada deskripsi.</p>
          ) : (
            <LazyMarkdown source={description} />
          )}
        </div>
      )}
    </section>
  );
}
