import type { TestSearchItemDto } from "@testpulse/shared";
import { Bot, Link2Off } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/forms";

/** Test otomatis yang tertaut ke case: cukup untuk ditampilkan; server menerima hanya `id`. */
export type LinkedTest = TestSearchItemDto;

interface AutomationLinkProps {
  slug: string;
  value: LinkedTest | null;
  onChange: (value: LinkedTest | null) => void;
  /** Error dari validasi/server untuk `automatedTestId`. */
  error?: string | undefined;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

type Search = { query: string; outcome: { items: LinkedTest[] } | { error: string } };

/**
 * Tautan case ke test otomatis (spec Tahap 4 §8.3, §5.3): kolom cari inline (`GET /tests?q=`, minimal 2 karakter),
 * hasil berupa daftar tombol "suite › nama"; test yang dipilih bisa dilepas. Pencarian ditunda sebentar setelah
 * mengetik dan hanya respons untuk kata terakhir yang dipakai.
 */
export function AutomationLink({ slug, value, onChange, error }: AutomationLinkProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [draft, setDraft] = useState("");
  const [debounced, setDebounced] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unlinkRef = useRef<HTMLButtonElement>(null);
  const linkedId = value?.id ?? null;
  const wasLinked = useRef(linkedId !== null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(draft.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    if (debounced.length < MIN_QUERY) return;
    let active = true;
    api.manual.searchTests(slug, debounced).then(
      (items) => {
        if (active) setSearch({ query: debounced, outcome: { items } });
      },
      (err: unknown) => {
        if (active) setSearch({ query: debounced, outcome: { error: errorMessage(err, "Gagal mencari test. Coba lagi.") } });
      },
    );
    return () => {
      active = false;
    };
  }, [slug, debounced]);

  // Fokus mengikuti peralihan antara kolom cari dan test terpilih (salah satunya hilang dari DOM).
  useEffect(() => {
    const linked = linkedId !== null;
    if (linked !== wasLinked.current) (linked ? unlinkRef : inputRef).current?.focus();
    wasLinked.current = linked;
  }, [linkedId]);

  function pick(test: LinkedTest) {
    setDraft("");
    setDebounced("");
    setSearch(null);
    onChange(test);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter di kolom cari tidak boleh mengirim formulir case.
    if (event.key === "Enter") event.preventDefault();
  }

  const searchable = debounced.length >= MIN_QUERY;
  const current = searchable && search?.query === debounced ? search.outcome : null;
  let status = "";
  if (draft.trim().length < MIN_QUERY) status = "";
  else if (!searchable || current === null) status = "Mencari…";
  else if ("error" in current) status = "";
  else status = current.items.length === 0 ? "Tidak ada test yang cocok." : `${current.items.length} test ditemukan.`;

  return (
    <div className="grid min-w-0 gap-2" data-testid="case-automation-link">
      {value ? (
        <span className="text-sm leading-none font-medium">Test otomatis</span>
      ) : (
        <Label htmlFor={id}>Test otomatis</Label>
      )}
      {value ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
          <p className="m-0 flex min-w-0 items-center gap-2 text-sm [overflow-wrap:anywhere]" data-testid="automation-selected">
            <Bot className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="sr-only">Tertaut ke test </span>
              {value.suite} › {value.name}
            </span>
          </p>
          <Button ref={unlinkRef} type="button" variant="outline" size="sm" onClick={() => onChange(null)} data-testid="automation-unlink">
            <Link2Off aria-hidden="true" />
            Lepas tautan
          </Button>
        </div>
      ) : (
        <>
          <Input
            ref={inputRef}
            id={id}
            type="search"
            value={draft}
            autoComplete="off"
            maxLength={100}
            aria-invalid={error ? true : undefined}
            aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(" ")}
            data-testid="automation-search"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p id={hintId} className="m-0 text-sm text-muted-foreground">
            Ketik minimal {MIN_QUERY} huruf nama test atau suite-nya (hasil dari run CI), lalu pilih. Boleh dikosongkan.
          </p>
          <p role="status" className="m-0 text-sm text-muted-foreground" data-testid="automation-status">
            {status}
          </p>
          {current && "error" in current ? (
            <p role="alert" className="m-0 text-sm font-medium text-destructive" data-testid="automation-search-error">
              {current.error}
            </p>
          ) : null}
          {current && "items" in current && current.items.length > 0 ? (
            <ul className="m-0 grid list-none divide-y divide-border rounded-md border bg-card p-0" aria-label="Hasil pencarian test">
              {current.items.map((test) => (
                <li key={test.id}>
                  <button
                    type="button"
                    className="block w-full min-w-0 px-3 py-2 text-left text-sm [overflow-wrap:anywhere] outline-hidden hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring"
                    data-testid={`automation-option-${test.id}`}
                    onClick={() => pick(test)}
                  >
                    {test.suite} › {test.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? (
        <p id={errorId} className="m-0 text-sm font-medium text-destructive" data-testid="field-error-automatedTestId">
          {error}
        </p>
      ) : null}
    </div>
  );
}
