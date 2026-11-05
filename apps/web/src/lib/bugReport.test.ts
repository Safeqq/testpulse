import { createBugBody } from "@testpulse/shared";
import { describe, expect, it } from "vitest";
import { buildBugReportDescription } from "./bugReport";

const base = {
  suite: "checkout",
  branch: "main",
  commitSha: "abcdef1234567890abcdef1234567890abcdef12",
  ciUrl: "https://ci.example.com/builds/42",
  message: "Diharapkan 3 tetapi 4",
};

describe("buildBugReportDescription", () => {
  it("memuat suite, branch, commit, link CI, dan pesan error dalam blok kode", () => {
    expect(buildBugReportDescription(base)).toBe(
      [
        "- **Suite:** checkout",
        "- **Branch:** `main`",
        "- **Commit:** `abcdef1234567890abcdef1234567890abcdef12`",
        "- **Link CI:** https://ci.example.com/builds/42",
        "",
        "**Pesan error:**",
        "",
        "```",
        "Diharapkan 3 tetapi 4",
        "```",
      ].join("\n"),
    );
  });

  it("menghilangkan baris yang tidak ada (commit, CI, pesan)", () => {
    const text = buildBugReportDescription({ suite: "s", branch: "dev", commitSha: null, ciUrl: null, message: null });
    expect(text).toBe(["- **Suite:** s", "- **Branch:** `dev`"].join("\n"));
  });

  it("pagar blok kode lebih panjang daripada deretan backtick di dalam pesan", () => {
    const text = buildBugReportDescription({ ...base, message: "a ``` b ````` c" });
    expect(text).toContain("\n``````\na ``` b ````` c\n``````");
  });

  it("memotong pesan sangat panjang agar deskripsi tetap lolos batas 20.000 karakter", () => {
    const text = buildBugReportDescription({ ...base, message: "x".repeat(50_000) });
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).toContain("… (dipotong)");
    expect(createBugBody.safeParse({ title: "abc", description: text }).success).toBe(true);
  });

  it("membuang karakter kontrol agar lolos validasi server, tetapi mempertahankan tab dan baris baru", () => {
    const text = buildBugReportDescription({ ...base, message: "a\u0000b\tc\nd\u001b\u0085e" });
    expect(text).toContain("ab\tc\nde");
    expect(createBugBody.safeParse({ title: "abc", description: text }).success).toBe(true);
  });
});
