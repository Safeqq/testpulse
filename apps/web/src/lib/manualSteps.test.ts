import { MAX_STEPS } from "@testpulse/shared";
import { describe, expect, it } from "vitest";
import { addStep, moveStep, removeStep, stepErrors, toCaseSteps, toStepDrafts, type StepDraft } from "./manualSteps";

function drafts(...actions: string[]): StepDraft[] {
  return toStepDrafts(actions.map((action) => ({ action, expected: "" })));
}

const actionsOf = (steps: readonly StepDraft[]) => steps.map((step) => step.action);

describe("addStep", () => {
  it("menambah langkah kosong di akhir", () => {
    const steps = addStep(drafts("a"));
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ action: "", expected: "" });
  });

  it("langkah baru punya id unik agar posisinya bisa dilacak setelah diurutkan ulang", () => {
    const steps = addStep(addStep(drafts("a")));
    expect(new Set(steps.map((step) => step.id)).size).toBe(3);
  });

  it("berhenti di 50 langkah; menambah lagi tidak mengubah apa pun", () => {
    let steps = drafts("a");
    for (let i = 0; i < 80; i += 1) steps = addStep(steps);
    expect(steps).toHaveLength(MAX_STEPS);
    expect(addStep(steps)).toBe(steps);
  });

  it("tidak mengubah daftar asal", () => {
    const before = drafts("a");
    addStep(before);
    expect(before).toHaveLength(1);
  });
});

describe("removeStep", () => {
  it("membuang langkah pada indeks itu", () => {
    expect(actionsOf(removeStep(drafts("a", "b", "c"), 1))).toEqual(["a", "c"]);
  });

  it("menghapus satu-satunya langkah menyisakan satu langkah kosong", () => {
    const steps = removeStep(drafts("isi"), 0);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ action: "", expected: "" });
  });

  it("indeks di luar daftar tidak mengubah apa pun", () => {
    const steps = drafts("a", "b");
    expect(removeStep(steps, 5)).toBe(steps);
    expect(removeStep(steps, -1)).toBe(steps);
  });
});

describe("moveStep", () => {
  it("▲ menukar dengan langkah sebelumnya, ▼ dengan sesudahnya", () => {
    expect(actionsOf(moveStep(drafts("a", "b", "c"), 2, -1))).toEqual(["a", "c", "b"]);
    expect(actionsOf(moveStep(drafts("a", "b", "c"), 0, 1))).toEqual(["b", "a", "c"]);
  });

  it("▲ di langkah pertama dan ▼ di langkah terakhir tidak mengubah apa pun", () => {
    const steps = drafts("a", "b", "c");
    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(moveStep(steps, 2, 1)).toBe(steps);
  });

  it("id ikut berpindah bersama isinya", () => {
    const steps = drafts("a", "b");
    const moved = moveStep(steps, 1, -1);
    expect(moved.map((step) => step.id)).toEqual([steps[1]!.id, steps[0]!.id]);
  });
});

describe("toStepDrafts / toCaseSteps", () => {
  it("bolak-balik tanpa membawa id ke isian yang dikirim", () => {
    const original = [
      { action: "Buka", expected: "Tampil" },
      { action: "Klik", expected: "" },
    ];
    expect(toCaseSteps(toStepDrafts(original))).toEqual(original);
  });

  it("case tanpa langkah (tidak mungkin dari server) tetap menghasilkan satu langkah kosong", () => {
    expect(toStepDrafts([])).toHaveLength(1);
  });
});

describe("stepErrors", () => {
  it("memetakan steps.<i>.action ke langkahnya", () => {
    const result = stepErrors({ "steps.0.action": "Langkah wajib diisi", "steps.2.action": "Langkah maksimal 2000 karakter" });
    expect(result.byStep[0]).toEqual({ action: "Langkah wajib diisi" });
    expect(result.byStep[2]).toEqual({ action: "Langkah maksimal 2000 karakter" });
    expect(result.byStep[1]).toBeUndefined();
    expect(result.general).toBeUndefined();
  });

  it("memetakan steps.<i>.expected dan menggabungkannya dengan action langkah yang sama", () => {
    const result = stepErrors({ "steps.1.action": "A", "steps.1.expected": "E" });
    expect(result.byStep[1]).toEqual({ action: "A", expected: "E" });
  });

  it("kunci steps (jumlah langkah) menjadi error umum editor", () => {
    expect(stepErrors({ steps: "Minimal 1 langkah" }).general).toBe("Minimal 1 langkah");
  });

  it("kunci lain diabaikan", () => {
    const result = stepErrors({ title: "Judul wajib", "steps.x.action": "salah", "steps.3.other": "salah" });
    expect(result).toEqual({ general: undefined, byStep: {} });
  });
});
