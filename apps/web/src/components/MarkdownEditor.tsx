import { lazy, Suspense, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Markdown berat (react-markdown + remark): hanya diunduh saat pratinjau dibuka pertama kali.
const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

interface MarkdownEditorProps {
  /** `name` textarea (dipakai untuk memindahkan fokus saat ada error) dan akhiran `field-error-<name>`. */
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
  /** data-testid textarea; tab dan pratinjau memakai `<testId>-tab-write`, `-tab-preview`, `-preview`. */
  testId: string;
  rows?: number;
}

/**
 * Kolom teks Markdown dengan tab Tulis/Pratinjau (tanpa komponen tab Radix: dua tombol `aria-pressed`, seperti filter
 * lain di aplikasi). Isi tetap di textarea yang disembunyikan saat pratinjau, jadi isian tidak hilang.
 */
export function MarkdownEditor({ name, label, value, onChange, error, hint, testId, rows = 8 }: MarkdownEditorProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [mode, setMode] = useState<"write" | "preview">("write");
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div role="group" aria-label={`Mode ${label.toLowerCase()}`} className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "write" ? "default" : "outline"}
            aria-pressed={mode === "write"}
            data-testid={`${testId}-tab-write`}
            onClick={() => setMode("write")}
          >
            Tulis
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "preview" ? "default" : "outline"}
            aria-pressed={mode === "preview"}
            data-testid={`${testId}-tab-preview`}
            onClick={() => setMode("preview")}
          >
            Pratinjau
          </Button>
        </div>
      </div>
      <textarea
        id={id}
        name={name}
        value={value}
        rows={rows}
        hidden={mode !== "write"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-base text-foreground shadow-xs transition-colors outline-hidden md:text-sm",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        )}
      />
      {mode === "preview" ? (
        <div
          role="region"
          aria-label={`Pratinjau ${label.toLowerCase()}`}
          className="min-h-24 min-w-0 rounded-md border bg-card px-3 py-2 text-sm [overflow-wrap:anywhere]"
          data-testid={`${testId}-preview`}
        >
          {value.trim() === "" ? (
            <p className="m-0 text-muted-foreground">Tidak ada yang dipratinjau.</p>
          ) : (
            <Suspense fallback={<p className="m-0 text-muted-foreground">Memuat pratinjau…</p>}>
              <Markdown source={value} />
            </Suspense>
          )}
        </div>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive" data-testid={`field-error-${name}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
