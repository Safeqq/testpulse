import { createBugBody } from "@testpulse/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/Markdown";
import { buildManualBugDescription, buildManualBugTitle, type ManualBugReportSource } from "./manualBugReport";

const base: ManualBugReportSource = {
  runNumber: 3,
  runName: "Regresi rilis",
  appVersion: "v0.4.0",
  suiteName: "Checkout",
  preconditions: "Sudah masuk sebagai pembeli",
  steps: [
    { action: "Buka keranjang", expected: "Keranjang tampil" },
    { action: "Klik bayar", expected: "Pembayaran sukses" },
  ],
  stepResults: [
    { status: "passed", note: "" },
    { status: "failed", note: "Tombol tidak merespons" },
  ],
  note: "Gagal di Firefox saja",
};

const render = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));
const valid = (description: string) => createBugBody.safeParse({ title: "abc", description }).success;

describe("buildManualBugTitle", () => {
  it("TC-<n> gagal: judul", () => {
    expect(buildManualBugTitle(12, "Login dengan email")).toBe("TC-12 gagal: Login dengan email");
  });

  it("judul 300 karakter dipotong ke 200 tanpa separuh pasangan surrogate", () => {
    const prefix = "TC-12 gagal: ";
    // Emoji (2 code unit) tepat melintasi batas 200: harus dibuang utuh, bukan dibelah.
    const title = `${"a".repeat(200 - prefix.length - 1)}😀${"b".repeat(100)}`;
    const result = buildManualBugTitle(12, title);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toBe(`${prefix}${"a".repeat(200 - prefix.length - 1)}`);
    expect(result).not.toMatch(/[\ud800-\udbff]$/);
    expect(createBugBody.safeParse({ title: result }).success).toBe(true);
  });

  it("baris baru dan karakter kontrol dibuang dari judul", () => {
    expect(buildManualBugTitle(1, "a\u0000b\n  c")).toBe("TC-1 gagal: ab c");
  });
});

describe("buildManualBugDescription", () => {
  it("memuat run, versi, suite, prasyarat, tabel langkah dengan ✗ pada langkah gagal, dan catatan case", () => {
    expect(buildManualBugDescription(base)).toBe(
      [
        "- **Run:** TR-3 · `Regresi rilis`",
        "- **Versi:** `v0.4.0`",
        "- **Suite:** `Checkout`",
        "",
        "**Prasyarat:**",
        "",
        "```",
        "Sudah masuk sebagai pembeli",
        "```",
        "",
        "**Langkah:**",
        "",
        "| # | Aksi | Hasil yang diharapkan | Hasil | Catatan |",
        "| --- | --- | --- | --- | --- |",
        "| 1 | `Buka keranjang` | `Keranjang tampil` | Lulus | – |",
        "| 2 | `Klik bayar` | `Pembayaran sukses` | **✗ Gagal** | `Tombol tidak merespons` |",
        "",
        "**Catatan case:**",
        "",
        "```",
        "Gagal di Firefox saja",
        "```",
      ].join("\n"),
    );
  });

  it("tanpa versi, prasyarat, dan catatan: bagian itu tidak ditulis; langkah belum diisi dan hasil lain diberi label", () => {
    const text = buildManualBugDescription({
      ...base,
      appVersion: null,
      preconditions: "  ",
      note: "",
      steps: [
        { action: "a", expected: "" },
        { action: "b", expected: "x" },
        { action: "c", expected: "y" },
      ],
      stepResults: [
        { status: null, note: "" },
        { status: "blocked", note: "" },
        { status: "skipped", note: "" },
      ],
    });
    expect(text).not.toContain("Versi");
    expect(text).not.toContain("Prasyarat");
    expect(text).not.toContain("Catatan case");
    expect(text).toContain("| 1 | `a` | – | Belum diisi | – |");
    expect(text).toContain("| 2 | `b` | `x` | Diblokir | – |");
    expect(text).toContain("| 3 | `c` | `y` | Dilewati | – |");
  });

  describe("teks dari case tidak bisa menyisipkan Markdown", () => {
    const hostile: ManualBugReportSource = {
      ...base,
      runName: "[x](javascript:alert(1))",
      suiteName: "a`b",
      preconditions: "```\n[p](javascript:alert(1))\n```",
      steps: [
        { action: "Klik [tombol](javascript:alert(1)) dan ``kode``", expected: "a | b ](javascript:alert(2))" },
        { action: "`mulai", expected: "back\\|slash" },
      ],
      stepResults: [
        { status: "failed", note: "lihat <img src=x onerror=alert(1)>\n# judul" },
        { status: "passed", note: "" },
      ],
      note: "````\n<script>alert(1)</script>",
    };

    it("teks sebaris dibungkus code span yang lebih panjang daripada backtick di dalamnya", () => {
      const text = buildManualBugDescription(hostile);
      expect(text).toContain("- **Run:** TR-3 · `[x](javascript:alert(1))`");
      expect(text).toContain("- **Suite:** ``a`b``");
      // Diakhiri backtick: spasi pengaman di kedua sisi agar pembatas tidak menyatu.
      expect(text).toContain("| 1 | ``` Klik [tombol](javascript:alert(1)) dan ``kode`` ``` |");
      // `|` di dalam sel di-escape agar tidak memecah sel tabel.
      expect(text).toContain("`a \\| b ](javascript:alert(2))`");
      expect(text).toContain("| 2 | `` `mulai `` |");
      // Catatan langkah satu baris: baris baru tidak bisa membuka judul.
      expect(text).toContain("`lihat <img src=x onerror=alert(1)> # judul`");
      expect(text).not.toMatch(/^# judul/m);
    });

    it("blok kode memakai pagar yang lebih panjang daripada isinya", () => {
      const text = buildManualBugDescription(hostile);
      expect(text).toContain("\n````\n```\n[p](javascript:alert(1))\n```\n````\n");
      expect(text).toContain("\n`````\n````\n<script>alert(1)</script>\n`````");
    });

    it("dirender oleh Markdown aman: tanpa tautan atau HTML, dan tiap baris tabel tetap 5 sel walau teks berisi |", () => {
      const html = render(buildManualBugDescription(hostile));
      expect(html).not.toContain("<a");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<h1");
      const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.match(/<t[hd][ >]/g)).toHaveLength(5);
      expect(html).toContain("<code>a | b ](javascript:alert(2))</code>");
    });
  });

  it("deskripsi sangat panjang dipotong ke 20.000 karakter dan tetap lolos validasi server", () => {
    const big = "x".repeat(2000);
    const text = buildManualBugDescription({
      ...base,
      preconditions: "p".repeat(5000),
      steps: Array.from({ length: 50 }, () => ({ action: big, expected: big })),
      stepResults: Array.from({ length: 50 }, (_, i) => ({ status: i === 1 ? ("failed" as const) : null, note: "n".repeat(1000) })),
      note: "c".repeat(5000),
    });
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).toContain("… (dipotong)");
    // Struktur tetap utuh: 50 baris langkah, langkah gagal masih bertanda.
    expect(text.match(/^\| \d+ \|/gm)).toHaveLength(50);
    expect(text).toContain("| 2 | ");
    expect(text).toContain("**✗ Gagal**");
    expect(valid(text)).toBe(true);
  });

  it("pemotongan tidak menyisakan separuh pasangan surrogate", () => {
    const text = buildManualBugDescription({ ...base, note: "😀".repeat(15_000) });
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(valid(text)).toBe(true);
  });

  it("deskripsi pendek tidak dipotong", () => {
    expect(buildManualBugDescription(base)).not.toContain("dipotong");
  });
});
