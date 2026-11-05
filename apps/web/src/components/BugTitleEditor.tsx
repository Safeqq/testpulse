import { Loader2, Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateBugPatch, type BugPatch } from "@/lib/bugForm";
import type { SaveResult } from "@/lib/bugSave";

interface BugTitleEditorProps {
  title: string;
  canEdit: boolean;
  /** Judul halaman (h1) bisa difokus dari luar, mis. setelah memuat ulang bug. */
  headingRef: Ref<HTMLHeadingElement>;
  onSave: (patch: BugPatch) => Promise<SaveResult>;
}

/** Judul bug (h1) dengan edit inline untuk tester/admin: Enter menyimpan, Escape membatalkan. */
export function BugTitleEditor({ title, canEdit, headingRef, onSave }: BugTitleEditorProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const editButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Fokus mengikuti mode: ke kolom saat edit dimulai, kembali ke tombol Ubah saat selesai atau dibatalkan.
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function open() {
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (pending) return;
    const validated = validateBugPatch({ title: draft });
    if (!validated.ok) {
      setError(validated.fields.title ?? "Judul tidak valid");
      input.current?.focus();
      return;
    }
    if (validated.patch.title === title) return cancel();
    setPending(true);
    const result = await onSave(validated.patch);
    setPending(false);
    if (result.ok) return setEditing(false);
    // Konflik ditangani banner di induk; draf tetap ada sampai bug dimuat ulang.
    if (!result.conflict) {
      setError(result.fields?.title ?? result.message ?? "Gagal menyimpan judul");
      input.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 basis-60 text-2xl font-semibold tracking-tight outline-hidden [overflow-wrap:anywhere]"
          data-testid="bug-title"
        >
          {title}
        </h1>
        {canEdit ? (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
            size="sm"
            aria-label="Ubah judul"
            data-testid="bug-title-edit"
            onClick={open}
          >
            <Pencil aria-hidden="true" />
            Ubah
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 gap-3" aria-label="Ubah judul">
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={inputId}>Judul</Label>
        <Input
          id={inputId}
          ref={input}
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          data-testid="bug-title-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {error ? (
          <p id={errorId} className="text-sm font-medium text-destructive" data-testid="field-error-title">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="bug-title-save">
          {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          Simpan
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={cancel} disabled={pending} data-testid="bug-title-cancel">
          Batal
        </Button>
      </div>
    </form>
  );
}
