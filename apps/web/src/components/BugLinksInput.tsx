import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const MAX_BUG_LINKS = 10;

/** Satu baris link yang sedang diedit; `key` stabil agar menghapus baris tengah tidak menggeser isian lain. */
export interface LinkDraft {
  key: number;
  url: string;
  title: string;
}

let nextKey = 0;
export function newLinkDraft(url = "", title = ""): LinkDraft {
  nextKey += 1;
  return { key: nextKey, url, title };
}

interface BugLinksInputProps {
  value: LinkDraft[];
  onChange: (links: LinkDraft[]) => void;
  /** Error per baris dengan kunci `links.<indeks>.url` / `links.<indeks>.title`, plus `links` untuk error daftar. */
  errors: Record<string, string>;
}

/** Daftar link (URL + judul opsional) yang bisa ditambah dan dihapus. */
export function BugLinksInput({ value, onChange, errors }: BugLinksInputProps) {
  const groupId = useId();
  const container = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);

  // Baris baru langsung difokus agar pengguna keyboard/pembaca layar bisa mengetik tanpa mencari kolomnya.
  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    container.current?.querySelector<HTMLInputElement>(`[data-testid="bug-link-url-${value.length - 1}"]`)?.focus();
  }, [value.length]);

  const update = (index: number, patch: Partial<LinkDraft>) =>
    onChange(value.map((link, i) => (i === index ? { ...link, ...patch } : link)));

  return (
    <div
      ref={container}
      role="group"
      aria-labelledby={`${groupId}-title`}
      className="grid min-w-0 gap-3"
      data-testid="bug-links"
    >
      <p id={`${groupId}-title`} className="m-0 text-sm leading-none font-medium">
        Link
      </p>
      {value.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          Tambahkan tautan terkait (mis. issue tracker atau dokumen). Maksimal {MAX_BUG_LINKS} link.
        </p>
      ) : null}
      {value.map((link, index) => (
        <LinkRow
          key={link.key}
          index={index}
          link={link}
          urlError={errors[`links.${index}.url`]}
          titleError={errors[`links.${index}.title`]}
          onChange={(patch) => update(index, patch)}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
      {errors.links ? (
        <p className="m-0 text-sm font-medium text-destructive" data-testid="field-error-links">
          {errors.links}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.length >= MAX_BUG_LINKS}
          data-testid="bug-link-add"
          onClick={() => {
            focusLast.current = true;
            onChange([...value, newLinkDraft()]);
          }}
        >
          <Plus aria-hidden="true" />
          Tambah link
        </Button>
      </div>
    </div>
  );
}

interface LinkRowProps {
  index: number;
  link: LinkDraft;
  urlError: string | undefined;
  titleError: string | undefined;
  onChange: (patch: Partial<LinkDraft>) => void;
  onRemove: () => void;
}

function LinkRow({ index, link, urlError, titleError, onChange, onRemove }: LinkRowProps) {
  const id = useId();
  const number = index + 1;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 rounded-md border bg-card p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start">
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-url`}>URL link {number}</Label>
        <Input
          id={`${id}-url`}
          name={`links.${index}.url`}
          inputMode="url"
          autoComplete="off"
          value={link.url}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? `${id}-url-error` : undefined}
          data-testid={`bug-link-url-${index}`}
          onChange={(e) => onChange({ url: e.target.value })}
        />
        {urlError ? (
          <p
            id={`${id}-url-error`}
            className="text-sm font-medium text-destructive"
            data-testid={`field-error-links.${index}.url`}
          >
            {urlError}
          </p>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-title`}>Judul link {number} (opsional)</Label>
        <Input
          id={`${id}-title`}
          name={`links.${index}.title`}
          autoComplete="off"
          value={link.title}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? `${id}-title-error` : undefined}
          data-testid={`bug-link-title-${index}`}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        {titleError ? (
          <p
            id={`${id}-title-error`}
            className="text-sm font-medium text-destructive"
            data-testid={`field-error-links.${index}.title`}
          >
            {titleError}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="sm:mt-[1.375rem]"
        aria-label={`Hapus link ${number}`}
        data-testid={`bug-link-remove-${index}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}
