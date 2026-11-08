import { MAX_STEPS } from "@testpulse/shared";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { MarkdownEditor, type EditorMode } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { addStep, moveStep, removeStep, type StepDraft, type StepErrors } from "@/lib/manualSteps";

interface StepEditorProps {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
  errors: StepErrors;
  /** Mode Tulis/Pratinjau tiap kolom, menurut `modeKey(step, field)`; dipegang induk agar bisa kembali ke Tulis saat memfokuskan error. */
  modes: Record<string, EditorMode>;
  onModeChange: (key: string, mode: EditorMode) => void;
}

/** Kunci mode untuk satu kolom langkah; mengikuti `id` langkah, bukan posisinya, jadi tetap benar setelah dipindah. */
export function modeKey(step: StepDraft, field: "action" | "expected"): string {
  return `${step.id}:${field}`;
}

type FocusTarget = "action" | "up" | "down" | "remove";

/**
 * Editor langkah test case (spec Tahap 4 §8.3): tiap langkah bernomor berisi "Aksi" dan "Hasil yang diharapkan"
 * (editor Markdown dengan Tulis/Pratinjau), tombol ▲/▼ dan hapus; "Tambah langkah" nonaktif setelah 50. Operasinya ada di
 * `manualSteps`. Memindah/menghapus/menambah mengubah susunan DOM, jadi fokus dikembalikan secara eksplisit ke kontrol
 * yang baru saja dipakai (atau tetangganya) agar pengguna keyboard tidak jatuh ke awal halaman.
 */
export function StepEditor({ steps, onChange, errors, modes, onModeChange }: StepEditorProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<{ id: string; target: FocusTarget } | null>(null);
  const full = steps.length >= MAX_STEPS;

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const index = steps.findIndex((step) => step.id === pending.id);
    if (index < 0) return;
    const find = (target: FocusTarget) => listRef.current?.querySelector<HTMLElement>(`[data-testid="step-${index}-${target}"]`);
    let element = find(pending.target);
    // Tombol ▲ di langkah pertama (atau ▼ di terakhir) nonaktif setelah dipindah: fokus ke arah sebaliknya.
    if (element instanceof HTMLButtonElement && element.disabled) element = find(pending.target === "up" ? "down" : "up");
    element?.focus();
  }, [steps]);

  function change(next: StepDraft[], focus?: { id: string; target: FocusTarget }) {
    pendingFocus.current = focus ?? null;
    onChange(next);
  }

  function update(index: number, patch: Partial<Pick<StepDraft, "action" | "expected">>) {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function remove(index: number) {
    const next = removeStep(steps, index);
    change(next, { id: next[Math.min(index, next.length - 1)]!.id, target: "remove" });
  }

  function add() {
    const next = addStep(steps);
    if (next === steps) return;
    change(next, { id: next[next.length - 1]!.id, target: "action" });
  }

  return (
    <fieldset className="grid min-w-0 gap-3 border-0 p-0" data-testid="case-steps">
      <legend className="p-0 text-sm font-medium">
        Langkah{" "}
        <span className="font-normal text-muted-foreground">
          ({steps.length} dari {MAX_STEPS})
        </span>
      </legend>
      <ol ref={listRef} className="m-0 grid list-none gap-4 p-0">
        {steps.map((step, index) => {
          const number = index + 1;
          const stepError = errors.byStep[index];
          return (
            <li key={step.id} className="grid min-w-0 gap-3 rounded-lg border bg-card p-4" data-testid={`step-${index}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Langkah {number}</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={`Pindah langkah ${number} ke atas`}
                    title="Pindah ke atas"
                    disabled={index === 0}
                    data-testid={`step-${index}-up`}
                    onClick={() => change(moveStep(steps, index, -1), { id: step.id, target: "up" })}
                  >
                    <span aria-hidden="true">▲</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={`Pindah langkah ${number} ke bawah`}
                    title="Pindah ke bawah"
                    disabled={index === steps.length - 1}
                    data-testid={`step-${index}-down`}
                    onClick={() => change(moveStep(steps, index, 1), { id: step.id, target: "down" })}
                  >
                    <span aria-hidden="true">▼</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={`Hapus langkah ${number}`}
                    title="Hapus langkah"
                    data-testid={`step-${index}-remove`}
                    onClick={() => remove(index)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <MarkdownEditor
                name={`steps.${index}.action`}
                label={`Aksi langkah ${number}`}
                value={step.action}
                onChange={(action) => update(index, { action })}
                error={stepError?.action}
                mode={modes[modeKey(step, "action")] ?? "write"}
                onModeChange={(mode) => onModeChange(modeKey(step, "action"), mode)}
                rows={3}
                testId={`step-${index}-action`}
              />
              <MarkdownEditor
                name={`steps.${index}.expected`}
                label={`Hasil yang diharapkan langkah ${number}`}
                value={step.expected}
                onChange={(expected) => update(index, { expected })}
                error={stepError?.expected}
                mode={modes[modeKey(step, "expected")] ?? "write"}
                onModeChange={(mode) => onModeChange(modeKey(step, "expected"), mode)}
                rows={3}
                hint="Boleh dikosongkan."
                testId={`step-${index}-expected`}
              />
            </li>
          );
        })}
      </ol>
      {errors.general ? (
        <p className="m-0 text-sm font-medium text-destructive" data-testid="field-error-steps">
          {errors.general}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={full} onClick={add} data-testid="step-add">
          <Plus aria-hidden="true" />
          Tambah langkah
        </Button>
        {full ? <span className="text-sm text-muted-foreground">Maksimal {MAX_STEPS} langkah.</span> : null}
      </div>
    </fieldset>
  );
}
