import type { BugDto } from "@testpulse/shared";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BugLinksInput, newLinkDraft, type LinkDraft } from "@/components/BugLinksInput";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { Button } from "@/components/ui/button";
import { remapLinkKeys, validateBugPatch, type BugPatch } from "@/lib/bugForm";
import type { SaveResult } from "@/lib/bugSave";
import { safeMarkdownUrl } from "@/lib/markdown-url";

interface BugLinksEditorProps {
  links: BugDto["links"];
  canEdit: boolean;
  onSave: (patch: BugPatch) => Promise<SaveResult>;
}

const LINK_CLASS = `${INLINE_LINK_CLASS} inline-flex max-w-full items-start gap-1.5`;

/** Link bug di panel samping: daftar tautan keluar, dengan editor inline (masukan link yang sama dengan formulir) untuk tester/admin. */
export function BugLinksEditor({ links, canEdit, onSave }: BugLinksEditorProps) {
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<LinkDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  /** `data-testid` yang difokus setelah galat baru dirender (pesan galat daftar baru ada di DOM setelah render). */
  const focusAfterErrors = useRef<string | null>(null);

  /**
   * Memfokuskan kolom pertama yang bermasalah (`links.<i>.url|title`), atau pesan galat daftar itu sendiri: tombol
   * Tambah bisa nonaktif (10 link), dan fokus pada tombol nonaktif tidak terjadi sehingga galatnya tak diumumkan.
   */
  function focusFirstInvalid(found: Record<string, string>) {
    const first = Object.keys(found)[0];
    const match = first ? /^links\.(\d+)\.(url|title)$/.exec(first) : null;
    focusAfterErrors.current = match ? `bug-link-${match[2]}-${match[1]}` : "field-error-links";
  }

  useEffect(() => {
    const target = focusAfterErrors.current;
    if (target === null) return;
    focusAfterErrors.current = null;
    editor.current?.querySelector<HTMLElement>(`[data-testid="${target}"]`)?.focus();
  }, [errors]);

  // Fokus mengikuti mode: ke URL link pertama (atau tombol Tambah bila belum ada) saat edit dimulai, kembali ke Ubah saat selesai.
  useEffect(() => {
    if (editing) {
      const root = editor.current;
      (root?.querySelector<HTMLElement>('[data-testid="bug-link-url-0"]') ?? root?.querySelector<HTMLElement>('[data-testid="bug-link-add"]'))?.focus();
    } else if (wasEditing.current) editButton.current?.focus();
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
    if (!validated.ok) {
      const mapped = remapLinkKeys(validated.fields, rowIndexes);
      setErrors(mapped);
      return focusFirstInvalid(mapped);
    }
    setErrors({});
    setPending(true);
    const result = await onSave(validated.patch);
    setPending(false);
    if (result.ok) return setEditing(false);
    if (!result.conflict) {
      const mapped = remapLinkKeys(result.fields ?? {}, rowIndexes);
      const shown = Object.keys(mapped).length > 0 ? mapped : { links: result.message ?? "Gagal menyimpan link" };
      setErrors(shown);
      focusFirstInvalid(shown);
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
        <div ref={editor} className="grid min-w-0 gap-3">
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
