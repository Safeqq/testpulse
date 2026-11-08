import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./snapshot.js";

const makeCase = () => ({
  id: "case-1",
  number: 7,
  title: "Login berhasil",
  preconditions: "Akun sudah terdaftar",
  steps: [
    { action: "Buka halaman login", expected: "Form tampil" },
    { action: "Isi kredensial", expected: "" },
  ],
  priority: "high" as const,
});

describe("buildSnapshot", () => {
  it("menyalin field case dan suite ke snapshot", () => {
    const snapshot = buildSnapshot(makeCase(), { name: "Autentikasi", position: 2 }, 4);
    expect(snapshot).toEqual({
      caseId: "case-1",
      caseNumber: 7,
      suiteName: "Autentikasi",
      suitePosition: 2,
      title: "Login berhasil",
      preconditions: "Akun sudah terdaftar",
      steps: [
        { action: "Buka halaman login", expected: "Form tampil" },
        { action: "Isi kredensial", expected: "" },
      ],
      priority: "high",
      position: 4,
    });
  });

  it("mengubah array langkah sumber setelah snapshot dibuat tidak mengubah snapshot", () => {
    const source = makeCase();
    const snapshot = buildSnapshot(source, { name: "Autentikasi", position: 0 }, 0);

    source.steps.push({ action: "Langkah baru", expected: "x" });
    source.steps[0]!.action = "Diubah";

    expect(snapshot.steps).toHaveLength(2);
    expect(snapshot.steps[0]!.action).toBe("Buka halaman login");
  });

  it("langkah snapshot adalah objek baru, bukan referensi", () => {
    const source = makeCase();
    const snapshot = buildSnapshot(source, { name: "Autentikasi", position: 0 }, 0);

    expect(snapshot.steps).not.toBe(source.steps);
    snapshot.steps.forEach((step, i) => expect(step).not.toBe(source.steps[i]));
  });
});
