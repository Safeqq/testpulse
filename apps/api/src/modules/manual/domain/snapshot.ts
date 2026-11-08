import type { CasePriority, CaseStep } from "@testpulse/shared";

// Salinan case yang disimpan pada run case (spec §4.2). Tidak pernah ikut berubah saat case sumbernya diubah.
export type RunCaseSnapshot = {
  caseId: string;
  caseNumber: number;
  suiteName: string;
  suitePosition: number;
  title: string;
  preconditions: string;
  steps: CaseStep[];
  priority: CasePriority;
  position: number;
};

export function buildSnapshot(
  c: { id: string; number: number; title: string; preconditions: string; steps: readonly CaseStep[]; priority: CasePriority },
  suite: { name: string; position: number },
  position: number,
): RunCaseSnapshot {
  return {
    caseId: c.id,
    caseNumber: c.number,
    suiteName: suite.name,
    suitePosition: suite.position,
    title: c.title,
    preconditions: c.preconditions,
    // Objek langkah disalin satu per satu agar snapshot tidak berbagi referensi dengan case sumber.
    steps: c.steps.map((step) => ({ action: step.action, expected: step.expected })),
    priority: c.priority,
    position,
  };
}
