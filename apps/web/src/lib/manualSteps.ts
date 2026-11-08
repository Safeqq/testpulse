import { MAX_STEPS, type CaseStep } from "@testpulse/shared";

/**
 * Langkah di formulir case: isian `CaseStep` ditambah `id` yang hanya dipakai klien. `id` menjaga identitas (kunci React,
 * mode Tulis/Pratinjau, fokus) saat langkah dipindah atau dihapus; ia tidak ikut terkirim ke server (`toCaseSteps`).
 */
export interface StepDraft extends CaseStep {
  id: string;
}

let nextId = 0;
function newStep(step: CaseStep = { action: "", expected: "" }): StepDraft {
  nextId += 1;
  return { id: `step-${nextId}`, ...step };
}

/** Isian langkah dari case yang tersimpan; case tanpa langkah (tidak mungkin dari server) mendapat satu langkah kosong. */
export function toStepDrafts(steps: readonly CaseStep[]): StepDraft[] {
  return steps.length === 0 ? [newStep()] : steps.map((step) => newStep(step));
}

/** Isian yang dikirim ke server: hanya `action` dan `expected`. */
export function toCaseSteps(steps: readonly StepDraft[]): CaseStep[] {
  return steps.map(({ action, expected }) => ({ action, expected }));
}

/** Menambah langkah kosong di akhir; sudah `MAX_STEPS` → daftar yang sama dikembalikan. */
export function addStep(steps: readonly StepDraft[]): StepDraft[] {
  return steps.length >= MAX_STEPS ? (steps as StepDraft[]) : [...steps, newStep()];
}

/** Membuang langkah ke-`index`; langkah terakhir yang tersisa diganti satu langkah kosong (case minimal punya 1 langkah). */
export function removeStep(steps: readonly StepDraft[], index: number): StepDraft[] {
  if (index < 0 || index >= steps.length) return steps as StepDraft[];
  const next = steps.filter((_, i) => i !== index);
  return next.length === 0 ? [newStep()] : next;
}

/** Menukar langkah ke-`index` dengan tetangganya (`-1` = ▲, `1` = ▼); di ujung daftar tidak mengubah apa pun. */
export function moveStep(steps: readonly StepDraft[], index: number, dir: -1 | 1): StepDraft[] {
  const target = index + dir;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return steps as StepDraft[];
  const next = [...steps];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export interface StepFieldErrors {
  action?: string;
  expected?: string;
}

export interface StepErrors {
  /** Error jumlah langkah (kunci `steps`, mis. "Minimal 1 langkah"). */
  general: string | undefined;
  /** Error per langkah, menurut indeks formulir. */
  byStep: Record<number, StepFieldErrors>;
}

const STEP_KEY = /^steps\.(\d+)\.(action|expected)$/;

/** Memetakan kunci error `steps.<i>.action|expected` (dari server atau skema bersama) ke langkahnya; `steps` ke error umum. */
export function stepErrors(fields: Record<string, string>): StepErrors {
  const byStep: Record<number, StepFieldErrors> = {};
  for (const [key, message] of Object.entries(fields)) {
    const match = STEP_KEY.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    byStep[index] = { ...byStep[index], [match[2] as "action" | "expected"]: message };
  }
  return { general: fields.steps, byStep };
}
