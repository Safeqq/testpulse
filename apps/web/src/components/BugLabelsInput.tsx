import { bugLabel } from "@testpulse/shared";
import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const MAX_BUG_LABELS = 10;

interface BugLabelsInputProps {
  value: string[];
  onChange: (labels: string[]) => void;
  /** Error dari validasi form (mis. saat simpan); error saat menambah label ditampilkan lokal. */
  error?: string | undefined;
}

/**
 * Masukan label berupa chip. Teks diketik lalu dijadikan label dengan Enter, koma, tombol Tambah, atau saat fokus
 * pergi; setiap label dinormalisasi dan divalidasi dengan `bugLabel` (aturan yang sama dengan server).
 */
export function BugLabelsInput({ value, onChange, error }: BugLabelsInputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const shownError = addError ?? error;

  /** Menambahkan tiap potongan; berhenti di potongan pertama yang tidak valid. Mengembalikan sisa draf yang belum diterima. */
  function commit(pieces: string[]): string {
    let labels = value;
    for (const [index, raw] of pieces.entries()) {
      if (raw.trim() === "") continue;
      const parsed = bugLabel.safeParse(raw);
      const problem = !parsed.success
        ? (parsed.error.issues[0]?.message ?? "Label tidak valid")
        : labels.includes(parsed.data)
          ? null
          : labels.length >= MAX_BUG_LABELS
            ? `Maksimal ${MAX_BUG_LABELS} label`
            : null;
      if (problem) {
        onChange(labels);
        setAddError(problem);
        return pieces.slice(index).join(",");
      }
      // Duplikat diabaikan tanpa pesan.
      if (parsed.success && !labels.includes(parsed.data)) labels = [...labels, parsed.data];
    }
    onChange(labels);
    setAddError(null);
    return "";
  }

  function handleChange(text: string) {
    setAddError(null);
    if (!text.includes(",")) return setDraft(text);
    const pieces = text.split(",");
    const rest = pieces.pop() ?? "";
    const left = commit(pieces);
    setDraft(left === "" ? rest : `${left},${rest}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter di kolom label menambah label, bukan mengirim form.
    event.preventDefault();
    setDraft(commit([draft]));
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
          onBlur={() => draft.trim() !== "" && setDraft(commit([draft]))}
        />
        <Button type="button" variant="outline" data-testid="bug-label-add" onClick={() => setDraft(commit([draft]))}>
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
