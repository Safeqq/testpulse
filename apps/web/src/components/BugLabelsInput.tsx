import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addLabels, MAX_BUG_LABELS } from "@/lib/bugForm";

interface BugLabelsInputProps {
  value: string[];
  onChange: (labels: string[]) => void;
  /** Teks yang sedang diketik tapi belum jadi label; dipegang induk agar saat simpan draf yang belum diterima ikut diperiksa. */
  draft: string;
  onDraftChange: (draft: string) => void;
  /** Error dari validasi form (mis. saat simpan); error saat menambah label ditampilkan lokal. */
  error?: string | undefined;
}

/**
 * Masukan label berupa chip. Teks diketik lalu dijadikan label dengan Enter, koma, atau tombol Tambah (tidak saat fokus
 * pergi: chip baru akan menggeser tombol di bawahnya dan menelan klik); draf yang belum jadi chip diperiksa saat simpan. Aturannya (`addLabels`) sama dengan server.
 */
export function BugLabelsInput({ value, onChange, draft, onDraftChange, error }: BugLabelsInputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [addError, setAddError] = useState<string | null>(null);
  const shownError = addError ?? error;

  /** Menerima potongan teks sebagai label; yang bermasalah tetap di kolom beserta pesannya. */
  function commit(pieces: string[]): string {
    const result = addLabels(value, pieces);
    onChange(result.labels);
    setAddError(result.error);
    return result.rest;
  }

  function handleChange(text: string) {
    setAddError(null);
    if (!text.includes(",")) return onDraftChange(text);
    const pieces = text.split(",");
    const last = pieces.pop() ?? "";
    const left = commit(pieces);
    onDraftChange(left === "" ? last : `${left},${last}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter di kolom label menambah label, bukan mengirim form.
    event.preventDefault();
    onDraftChange(commit([draft]));
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>Label</Label>
      <div className="flex min-w-0 gap-2">
        <Input
          id={id}
          name="labels"
          value={draft}
          autoComplete="off"
          aria-invalid={shownError ? true : undefined}
          aria-describedby={[shownError ? errorId : null, hintId].filter(Boolean).join(" ")}
          data-testid="bug-labels"
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button type="button" variant="outline" data-testid="bug-label-add" onClick={() => onDraftChange(commit([draft]))}>
          Tambah
        </Button>
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        Ketik label lalu tekan Enter atau koma. Huruf kecil, angka, dan tanda hubung; maksimal {MAX_BUG_LABELS} label.
      </p>
      {shownError ? (
        <p id={errorId} className="text-sm font-medium text-destructive" data-testid="field-error-labels">
          {shownError}
        </p>
      ) : null}
      {value.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Label terpilih" data-testid="bug-label-list">
          {value.map((label) => (
            <li key={label} className="max-w-full">
              <Badge variant="secondary" className="max-w-full gap-1 pr-1" data-testid={`bug-label-${label}`}>
                <span className="min-w-0 truncate">{label}</span>
                <button
                  type="button"
                  aria-label={`Hapus label ${label}`}
                  data-testid={`bug-label-remove-${label}`}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm outline-hidden hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring"
                  onClick={() => onChange(value.filter((l) => l !== label))}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
