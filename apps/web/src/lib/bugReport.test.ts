import { createBugBody } from "@testpulse/shared";
import { describe, expect, it } from "vitest";
import { buildBugReportDescription, buildBugReportTitle } from "./bugReport";

const base = {
  suite: "checkout",
  branch: "main",
  commitSha: "abcdef1234567890abcdef1234567890abcdef12",
  ciUrl: "https://ci.example.com/builds/42",
  message: "Diharapkan 3 tetapi 4",
};

const valid = (description: string) => createBugBody.safeParse({ title: "abc", description }).success;

describe("buildBugReportDescription", () => {
  it("memuat suite, branch, commit, link CI, dan pesan error dalam blok kode", () => {
    expect(buildBugReportDescription(base)).toBe(
      [
        "- **Suite:** `checkout`",
        "- **Branch:** `main`",
        "- **Commit:** `abcdef1234567890abcdef1234567890abcdef12`",
        "- **Link CI:** <https://ci.example.com/builds/42>",
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
    expect(text).toBe(["- **Suite:** `s`", "- **Branch:** `dev`"].join("\n"));
  });

  it("pagar blok kode lebih panjang daripada deretan backtick di dalam pesan", () => {
    const text = buildBugReportDescription({ ...base, message: "a ``` b ````` c" });
    expect(text).toContain("\n``````\na ``` b ````` c\n``````");
  });

  describe("data dari pihak lain tidak bisa menyisipkan Markdown", () => {
    it("suite berisi tautan dan judul tetap berada di dalam satu code span satu baris", () => {
      const text = buildBugReportDescription({ ...base, suite: "[x](https://e.vil)\n# h" });
      expect(text.split("\n")[0]).toBe("- **Suite:** `[x](https://e.vil) # h`");
      expect(text).not.toMatch(/^# h/m);
    });

    it("suite dengan backtick memakai pembatas yang lebih panjang", () => {
      expect(buildBugReportDescription({ ...base, suite: "a`b``c" }).split("\n")[0]).toBe("- **Suite:** ```a`b``c```");
      // Diawali/diakhiri backtick: spasi pengaman agar pembatas tidak menyatu.
      expect(buildBugReportDescription({ ...base, suite: "`x`" }).split("\n")[0]).toBe("- **Suite:** `` `x` ``");
    });

    it("branch dan commit juga dibungkus code span", () => {
      const text = buildBugReportDescription({ ...base, branch: "feat/`x`", commitSha: "ab`c" });
      expect(text).toContain("- **Branch:** `` feat/`x` ``");
      expect(text).toContain("- **Commit:** ``ab`c``");
    });

    it("link CI dengan spasi atau tautan Markdown tidak ditulis; yang bersih menjadi autolink", () => {
      const evil = buildBugReportDescription({ ...base, ciUrl: "https://ci.example.com/a b](https://e.vil) [klik](https://e.vil)" });
      expect(evil).not.toContain("Link CI");
      expect(evil).not.toContain("e.vil");
      expect(buildBugReportDescription({ ...base, ciUrl: "https://ci.example.com/a>b" })).not.toContain("Link CI");
      expect(buildBugReportDescription({ ...base, ciUrl: "javascript:alert(1)" })).not.toContain("Link CI");
      expect(buildBugReportDescription({ ...base, ciUrl: "https://ci.example.com/b?x=1&y=2" })).toContain(
        "- **Link CI:** <https://ci.example.com/b?x=1&y=2>",
      );
    });
  });

  it("memotong pesan sangat panjang agar deskripsi tetap lolos batas 20.000 karakter", () => {
    const text = buildBugReportDescription({ ...base, message: "x".repeat(50_000) });
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).toContain("… (dipotong)");
    expect(valid(text)).toBe(true);
  });

  it("pesan panjang dengan deretan backtick panjang: pagar yang ikut memanjang tidak melewati batas", () => {
    // Backtick di tepi potongan membuat pagar 400+ karakter; total harus tetap di bawah batas.
    const message = `${"`".repeat(400)}${"y".repeat(19_990)}${"`".repeat(300)}${"z".repeat(5_000)}`;
    const text = buildBugReportDescription({ ...base, message });
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(valid(text)).toBe(true);
    // Pagar tetap lebih panjang daripada backtick mana pun di dalam isi yang tersisa.
    const lines = text.split("\n");
    const fence = lines[lines.length - 1]!;
    expect(lines[lines.length - 3]).toBe(fence);
    const inner = lines.slice(lines.length - 2, lines.length - 1).join("\n");
    expect(Math.max(...(inner.match(/`+/g) ?? [""]).map((run) => run.length))).toBeLessThan(fence.length);
  });

  it("membuang karakter kontrol agar lolos validasi server, tetapi mempertahankan tab dan baris baru", () => {
    const text = buildBugReportDescription({ ...base, suite: "su\u0000ite", message: "a\u0000b\tc\nd\u001b\u0085e" });
    expect(text).toContain("`suite`");
    expect(text).toContain("ab\tc\nde");
    expect(valid(text)).toBe(true);
  });
});

describe("buildBugReportTitle", () => {
  const validTitle = (title: string) => createBugBody.shape.title.safeParse(title).success;

  it("nama test 500 karakter dengan emoji tepat di batas: dipotong 200 code unit tanpa memecah pasangan surrogate", () => {
    // 199 huruf lalu emoji (2 code unit, indeks 199–200): memotong di 200 akan menyisakan separuh surrogate.
    const name = `${"a".repeat(199)}😀${"b".repeat(299)}`;
    expect(name.length).toBe(500);
    const title = buildBugReportTitle(name);
    expect(title).toBe("a".repeat(199));
    expect(/[\ud800-\udbff]$/.test(title)).toBe(false);
    expect(validTitle(title)).toBe(true);
  });

  it("emoji yang muat utuh di batas tetap dipertahankan", () => {
    const title = buildBugReportTitle(`${"a".repeat(198)}😀${"b".repeat(300)}`);
    expect(title).toBe(`${"a".repeat(198)}😀`);
    expect(title.length).toBe(200);
    expect(validTitle(title)).toBe(true);
  });

  it("membuang karakter kontrol C0/C1 dan merapikan spasi agar lolos validasi judul", () => {
    const title = buildBugReportTitle("  login\u0000 gagal\u0085\u009f di\n\tcheckout\u007f  ");
    expect(title).toBe("login gagal di checkout");
    expect(validTitle(title)).toBe(true);
  });

  it("karakter kontrol dibuang sebelum memotong, jadi tidak menghabiskan jatah 200 karakter", () => {
    const title = buildBugReportTitle(`${"\u0085".repeat(300)}${"x".repeat(250)}`);
    expect(title).toBe("x".repeat(200));
  });
});
