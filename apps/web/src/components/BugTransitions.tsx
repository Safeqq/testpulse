import { BUG_RESOLUTIONS, type BugResolution, type BugStatus } from "@testpulse/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BUG_RESOLUTION_LABEL } from "@/lib/bugs";
import type { SaveResult } from "@/lib/bugSave";
import { transitionsFor, type TransitionOption } from "@/lib/bugTransitions";

interface BugTransitionsProps {
  status: BugStatus;
  /** Menyimpan perubahan status (dan resolusi); galat per field dikembalikan untuk ditampilkan di tempat. */
  onTransition: (to: BugStatus, resolution: BugResolution | undefined) => Promise<SaveResult>;
}

/**
 * Tombol transisi status yang diizinkan dari status sekarang. Transisi yang mewajibkan resolusi membuka pilihan
 * resolusi inline (bukan dialog) dengan Konfirmasi dan Batal; yang lain langsung disimpan.
 */
export function BugTransitions({ status, onTransition }: BugTransitionsProps) {
  const selectId = useId();
  const errorId = `${selectId}-error`;
  const triggers = useRef(new Map<BugStatus, HTMLButtonElement>());
  const selectRef = useRef<HTMLSelectElement>(null);
  const [choosing, setChoosing] = useState<TransitionOption | null>(null);
  const [resolution, setResolution] = useState<BugResolution | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Pilihan resolusi yang baru terbuka langsung menerima fokus agar pengguna keyboard/pembaca layar tidak mencarinya.
  useEffect(() => {
    if (choosing) selectRef.current?.focus();
  }, [choosing]);

  async function run(option: TransitionOption, chosen: BugResolution | undefined) {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await onTransition(option.to, chosen);
    setPending(false);
    if (result.ok) {
      setChoosing(null);
      setResolution("");
      return;
    }
    if (result.fields?.resolution) {
      setError(result.fields.resolution);
      selectRef.current?.focus();
    }
  }

  function start(option: TransitionOption) {
    if (!option.needsResolution) return void run(option, undefined);
    setError(null);
    setChoosing(option);
  }

  function confirm() {
    if (!choosing) return;
    if (resolution === "") {
      setError("Pilih resolusi lebih dulu");
      selectRef.current?.focus();
      return;
    }
    void run(choosing, resolution);
  }

  function cancel() {
    const trigger = choosing ? triggers.current.get(choosing.to) : undefined;
    setChoosing(null);
    setResolution("");
    setError(null);
    // Tombol pemicunya masih terpasang selama pilihan terbuka: fokus kembali ke sana.
    trigger?.focus();
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ubah status">
        {transitionsFor(status).map((option) => (
          <Button
            key={option.to}
            ref={(element) => {
              if (element) triggers.current.set(option.to, element);
              else triggers.current.delete(option.to);
            }}
            type="button"
            size="sm"
            variant={option.to === "in_progress" || option.to === "resolved" ? "default" : "outline"}
            aria-expanded={option.needsResolution ? choosing?.to === option.to : undefined}
            disabled={pending && choosing === null}
            data-testid={`bug-transition-${option.to}`}
            onClick={() => start(option)}
          >
            {pending && choosing === null ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            {option.label}
          </Button>
        ))}
      </div>
      {choosing ? (
        <div role="group" aria-label={`${choosing.label}: pilih resolusi`} className="grid min-w-0 gap-3 rounded-lg border bg-card p-4">
          <div className="grid min-w-0 gap-1.5 sm:max-w-xs [&>span]:w-full">
            <Label htmlFor={selectId}>Resolusi</Label>
            <NativeSelect
              id={selectId}
              ref={selectRef}
              value={resolution}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              data-testid="bug-resolution"
              className="w-full"
              onChange={(e) => {
                setResolution(e.target.value as BugResolution | "");
                setError(null);
              }}
            >
              <option value="">Pilih resolusi…</option>
              {BUG_RESOLUTIONS.map((value) => (
                <option key={value} value={value}>
                  {BUG_RESOLUTION_LABEL[value]}
                </option>
              ))}
            </NativeSelect>
            {error ? (
              <p id={errorId} className="text-sm font-medium text-destructive" data-testid="field-error-resolution">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={confirm} disabled={pending} data-testid="bug-resolution-confirm">
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Konfirmasi
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={cancel} disabled={pending} data-testid="bug-resolution-cancel">
              Batal
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
