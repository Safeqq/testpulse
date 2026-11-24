import { describe, expect, it } from "vitest";
import { clipCodePoints, codeSpan, fenceFor, safeAutolink } from "./index.js";

describe("codeSpan", () => {
  it("teks biasa menjadi code span satu baris", () => {
    expect(codeSpan("Chrome 130 / Windows 11")).toBe("`Chrome 130 / Windows 11`");
  });

  it("tautan, heading, dan baris baru tetap di dalam satu code span satu baris", () => {
    expect(codeSpan("[x](https://e.vil)\n# h")).toBe("`[x](https://e.vil) # h`");
  });

  it("pembatas lebih panjang daripada deretan backtick di dalam teks", () => {
    expect(codeSpan("a`b``c")).toBe("```a`b``c```");
  });

  it("teks yang diawali atau diakhiri backtick diberi spasi pengaman", () => {
    expect(codeSpan("`x`")).toBe("`` `x` ``");
  });
});

describe("fenceFor", () => {
  it("minimal tiga backtick", () => {
    expect(fenceFor("tanpa backtick")).toBe("```");
  });

  it("lebih panjang daripada deretan backtick terpanjang di dalam teks", () => {
    expect(fenceFor("a ```` b")).toBe("`````");
  });
});

describe("safeAutolink", () => {
  it("URL http(s) bersih menjadi autolink", () => {
    expect(safeAutolink("https://ci.example.com/run/1")).toBe("<https://ci.example.com/run/1>");
    expect(safeAutolink("http://x.io")).toBe("<http://x.io>");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "https://x.io/a b", "https://x.io/<b>", "ftp://x.io", ""])(
    "%j tidak ditulis",
    (url) => {
      expect(safeAutolink(url)).toBeNull();
    },
  );
});

describe("clipCodePoints", () => {
  it("teks yang muat tidak diubah", () => {
    expect(clipCodePoints("abc", 3)).toBe("abc");
  });

  it("dipotong ke batas code unit", () => {
    expect(clipCodePoints("abcdef", 4)).toBe("abcd");
  });

  it("tidak menyisakan separuh pasangan surrogate", () => {
    const text = "ab😀c";
    // "ab" + high surrogate = 3 code unit; potongan harus membuang high surrogate itu.
    const clipped = clipCodePoints(text, 3);
    expect(clipped).toBe("ab");
    expect(/[\ud800-\udbff]$/.test(clipped)).toBe(false);
  });

  it("emoji yang muat utuh di batas dipertahankan", () => {
    expect(clipCodePoints("ab😀c", 4)).toBe("ab😀");
  });
});
