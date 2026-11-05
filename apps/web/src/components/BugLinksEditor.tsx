import type { BugDto } from "@testpulse/shared";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BugLinksInput, newLinkDraft, type LinkDraft } from "@/components/BugLinksInput";
import { Button } from "@/components/ui/button";
import { remapLinkKeys, validateBugPatch, type BugPatch } from "@/lib/bugForm";
import type { SaveResult } from "@/lib/bugSave";
import { safeMarkdownUrl } from "@/lib/markdown-url";

interface BugLinksEditorProps {
  links: BugDto["links"];
  canEdit: boolean;
  onSave: (patch: BugPatch) => Promise<SaveResult>;
}

const LINK_CLASS =
  "inline-flex max-w-full items-start gap-1.5 rounded-sm font-medium text-link underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring";

/** Link bug di panel samping: daftar tautan keluar, dengan editor inline (masukan link yang sama dengan formulir) untuk tester/admin. */
export function BugLinksEditor({ links, canEdit, onSave }: BugLinksEditorProps) {
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<LinkDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!editing && wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function open() {
    setRows(links.map((link) => newLinkDraft(link.url, link.title ?? "")));
    setErrors({});
    setEditing(true);
  }

  async function save() {
    if (pending) return;
    // Baris yang sama sekali kosong diabaikan; indeksnya dicatat untuk memetakan galat ke baris formulir.
    const rowIndexes = rows.flatMap((row, index) => (row.url.trim() === "" && row.title.trim() === "" ? [] : [index]));
    const validated = validateBugPatch({
      links: rowIndexes.map((index) => ({ url: rows[index]!.url.trim(), title: rows[index]!.title })),
    });
    if (!validated.ok) return setErrors(remapLinkKeys(validated.fields, rowIndexes));
    setErrors({});
    setPending(true);
    const result = await onSave(validated.patch);
    setPending(false);
    if (result.ok) return setEditing(false);
    if (!result.conflict) {
      const mapped = remapLinkKeys(result.fields ?? {}, rowIndexes);
      setErrors(Object.keys(mapped).length > 0 ? mapped : { links: result.message ?? "Gagal menyimpan link" });
    }
  }

  return (
    <section aria-labelledby="bug-links-title" className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="bug-links-title" className="text-sm font-semibold">
          Link
        </h2>
        {canEdit && !editing ? (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
            size="sm"
            aria-label="Ubah link"
            data-testid="bug-links-edit"
            onClick={open}
          >
            <Pencil aria-hidden="true" />
            Ubah
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="grid min-w-0 gap-3">
          <BugLinksInput value={rows} onChange={setRows} errors={errors} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={save} disabled={pending} data-testid="bug-links-save">
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Simpan
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending} data-testid="bug-links-cancel">
              Batal
            </Button>
          </div>
        </div>
      ) : links.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground" data-testid="bug-links">
          Belum ada link.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0 text-sm" data-testid="bug-links">
          {links.map((link, index) => {
            const href = safeMarkdownUrl(link.url);
            const text = link.title ?? link.url;
            return (
              <li key={`${index}:${link.url}`} className="min-w-0">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only"> (buka di tab baru)</span>
                  </a>
                ) : (
                  <span className="[overflow-wrap:anywhere]">{text}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
