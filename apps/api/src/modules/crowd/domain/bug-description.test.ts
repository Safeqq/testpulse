import { describe, expect, it } from "vitest";
import { buildCrowdBugDescription, MAX_BUG_DESCRIPTION, type CrowdBugDescriptionInput } from "./bug-description.js";

const base: CrowdBugDescriptionInput = {
  reportNumber: 14,
  cycleNumber: 2,
  cycleTitle: "Uji rilis",
  reporterName: "Budi",
  environment: "Chrome 130 / Windows 11",
  steps: "1. Buka form\n2. Klik **Simpan**",
  expected: "Tersimpan",
  actual: "Error 500",
  links: ["https://evidence.example.com/v/1"],
};

const TRUNCATED = "… (dipotong)";
/** Panjang deskripsi `base` dengan langkah kosong, untuk menyusun langkah yang membuat total tepat sepanjang tertentu. */
const lengthWithoutSteps = buildCrowdBugDescription({ ...base, steps: "" }).length;

describe("buildCrowdBugDescription", () => {
  it("teks lengkap: baris kosong di antara bagian, satu link bukti per baris", () => {
    const text = buildCrowdBugDescription({ ...base, links: [...base.links, "https://ok.example.com"] });
    expect(text).toBe(
      [
        "- **Laporan crowdtesting:** `CR-14` di cycle `CY-2` · `Uji rilis`",
        "- **Pelapor:** `Budi`",
        "- **Lingkungan:** `Chrome 130 / Windows 11`",
        "",
        "### Langkah reproduksi",
        "",
        "1. Buka form\n2. Klik **Simpan**",
        "",
        "### Hasil yang diharapkan",
        "",
        "Tersimpan",
        "",
        "### Yang terjadi",
        "",
        "Error 500",
        "",
        "### Link bukti",
        "",
        "- <https://evidence.example.com/v/1>",
        "- <https://ok.example.com>",
      ].join("\n"),
    );
  });

  it("metadata di atas, lalu bagian langkah, diharapkan, terjadi, dan link bukti", () => {
    const text = buildCrowdBugDescription(base);
    const lines = text.split("\n");
    expect(lines[0]).toBe("- **Laporan crowdtesting:** `CR-14` di cycle `CY-2` · `Uji rilis`");
    expect(lines[1]).toBe("- **Pelapor:** `Budi`");
    expect(lines[2]).toBe("- **Lingkungan:** `Chrome 130 / Windows 11`");
    expect(text).toContain("### Langkah reproduksi\n\n1. Buka form\n2. Klik **Simpan**");
    expect(text).toContain("### Hasil yang diharapkan\n\nTersimpan");
    expect(text).toContain("### Yang terjadi\n\nError 500");
    expect(text).toContain("### Link bukti\n\n- <https://evidence.example.com/v/1>");
    expect(text.indexOf("Langkah")).toBeLessThan(text.indexOf("diharapkan"));
    expect(text.indexOf("diharapkan")).toBeLessThan(text.indexOf("terjadi"));
  });

  it("tanpa link bukti: bagian link tidak ditulis", () => {
    const text = buildCrowdBugDescription({ ...base, links: [] });
    expect(text).not.toContain("Link bukti");
    expect(text.endsWith("### Yang terjadi\n\nError 500")).toBe(true);
  });

  // Review Focus 4: metadata dari crowd tidak bisa membentuk link, heading, atau menimpa baris lain.
  it("nama pelapor, lingkungan, dan judul cycle berbahaya tetap di dalam code span satu baris", () => {
    const text = buildCrowdBugDescription({
      ...base,
      reporterName: "Budi`](javascript:alert(1))\n# Status: Diterima",
      environment: "[klik](https://e.vil)",
      cycleTitle: "``x``",
    });
    const lines = text.split("\n");
    expect(lines[1]).toBe("- **Pelapor:** ``Budi`](javascript:alert(1)) # Status: Diterima``");
    expect(lines[2]).toBe("- **Lingkungan:** `[klik](https://e.vil)`");
    expect(lines[0]).toBe("- **Laporan crowdtesting:** `CR-14` di cycle `CY-2` · ``` ``x`` ```");
  });

  it("link bukti yang tidak aman tidak ditulis", () => {
    const text = buildCrowdBugDescription({
      ...base,
      links: ["javascript:alert(1)", "https://x.io/a b", "https://ok.example.com"],
    });
    expect(text).not.toContain("javascript:");
    expect(text).not.toContain("x.io/a b");
    expect(text).toContain("- <https://ok.example.com>");
  });

  it("semua link tidak aman: bagian link tidak ditulis", () => {
    expect(buildCrowdBugDescription({ ...base, links: ["javascript:x"] })).not.toContain("Link bukti");
  });

  it("karakter kontrol dibuang agar lolos validasi deskripsi bug", () => {
    const text = buildCrowdBugDescription({ ...base, steps: "a\u0000b\u001bc langkah panjang" });
    expect(text).toContain("abc langkah panjang");
    expect(/[\u0000-\u0008\u001b]/.test(text)).toBe(false);
  });

  it("isi sangat panjang dipotong ≤ 20.000 tanpa separuh surrogate, metadata tetap utuh", () => {
    const text = buildCrowdBugDescription({
      ...base,
      steps: "😀".repeat(10000),
      expected: "e".repeat(2000),
      actual: "a".repeat(2000),
    });
    expect(MAX_BUG_DESCRIPTION).toBe(20000);
    expect(text.length).toBeLessThanOrEqual(20000);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(text)).toBe(false);
    expect(text.startsWith("- **Laporan crowdtesting:** `CR-14`")).toBe(true);
    expect(text).toContain("… (dipotong)");
    expect(text).toContain("### Yang terjadi");
  });

  it("tepat 20.000 karakter: tidak dipotong", () => {
    const steps = "x".repeat(MAX_BUG_DESCRIPTION - lengthWithoutSteps);
    const text = buildCrowdBugDescription({ ...base, steps });
    expect(text).toHaveLength(MAX_BUG_DESCRIPTION);
    expect(text).toContain(`### Langkah reproduksi\n\n${steps}\n`);
    expect(text).not.toContain(TRUNCATED);
  });

  it("langkah dipotong sebanyak kelebihannya saja: hasil tepat 20.000, bagian lain utuh", () => {
    const text = buildCrowdBugDescription({ ...base, steps: "x".repeat(MAX_BUG_DESCRIPTION - lengthWithoutSteps + 5000) });
    expect(text).toHaveLength(MAX_BUG_DESCRIPTION);
    const kept = MAX_BUG_DESCRIPTION - lengthWithoutSteps - TRUNCATED.length;
    expect(text).toContain(`### Langkah reproduksi\n\n${"x".repeat(kept)}${TRUNCATED}\n`);
    expect(text).toContain("### Hasil yang diharapkan\n\nTersimpan\n");
    expect(text).toContain("### Yang terjadi\n\nError 500\n");
  });

  it("memotong langkah saja tidak cukup: bagian berikutnya ikut dipotong", () => {
    const text = buildCrowdBugDescription({ ...base, steps: "langkah", expected: "e".repeat(MAX_BUG_DESCRIPTION) });
    expect(text).toHaveLength(MAX_BUG_DESCRIPTION);
    expect(text).toContain(`### Langkah reproduksi\n\n${TRUNCATED}\n`);
    expect(text).toMatch(/### Hasil yang diharapkan\n\ne+… \(dipotong\)\n/);
    expect(text).toContain("### Yang terjadi\n\nError 500\n");
  });

  it("metadata sendiri melebihi batas: ketiga bagian dipotong lalu berhenti tanpa galat", () => {
    const text = buildCrowdBugDescription({ ...base, environment: "E".repeat(MAX_BUG_DESCRIPTION) });
    expect(text.length).toBeGreaterThan(MAX_BUG_DESCRIPTION);
    expect(text.split(TRUNCATED)).toHaveLength(4);
  });
});
