import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const render = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));

describe("Markdown", () => {
  it("merender sintaks yang didukung menjadi elemen", () => {
    const html = render(
      ["# Judul", "", "Teks **tebal** dan *miring* dengan `kode`.", "", "- satu", "- dua", "", "> kutipan", "", "---"].join("\n"),
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>tebal</strong>");
    expect(html).toContain("<em>miring</em>");
    expect(html).toContain("<code");
    expect(html).toContain("<ul");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<hr");
  });

  describe("HTML mentah", () => {
    it("tampil sebagai teks, tidak pernah menjadi elemen", () => {
      const html = render("<script>alert(1)</script>");
      expect(html).not.toContain("<script");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("tag sebaris dan atribut event handler inert", () => {
      const html = render('Halo <img src=x onerror="alert(1)"> dan <b onclick="x()">tebal</b>');
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<b ");
      expect(html).not.toMatch(/<[a-z][^>]*\sonerror=/i);
      expect(html).not.toMatch(/<[a-z][^>]*\sonclick=/i);
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });

    it("blok HTML (iframe, style, div) tidak menjadi elemen", () => {
      const html = render('<iframe src="https://evil.example"></iframe>\n\n<style>body{display:none}</style>\n\n<div style="x">a</div>');
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("<style");
      expect(html).not.toContain("<div style");
      // Tampil sebagai teks yang di-escape, bukan hilang diam-diam.
      expect(html).toContain("&lt;iframe src=&quot;https://evil.example&quot;&gt;&lt;/iframe&gt;");
      expect(html).toContain("&lt;style&gt;body{display:none}&lt;/style&gt;");
      expect(html).toContain("&lt;div style=&quot;x&quot;&gt;a&lt;/div&gt;");
    });
  });

  describe("link", () => {
    it("memakai target=_blank dan rel noopener noreferrer", () => {
      const html = render("[situs](https://x.io/a) dan <https://y.io> dan [surel](mailto:a@b.c)");
      const anchors = html.match(/<a [^>]*>/g) ?? [];
      expect(anchors).toHaveLength(3);
      for (const anchor of anchors) {
        expect(anchor).toContain('target="_blank"');
        expect(anchor).toContain('rel="noopener noreferrer"');
      }
      expect(html).toContain('href="https://x.io/a"');
      expect(html).toContain('href="mailto:a@b.c"');
    });

    it.each([
      ["javascript:alert(1)"],
      ["JaVaScRiPt:alert(1)"],
      ["data:text/html;base64,PHNjcmlwdD4="],
      ["vbscript:msgbox(1)"],
      ["/relatif"],
    ])("membuang href %s tetapi teks tetap tampil", (url) => {
      const html = render(`[klik saya](${url})`);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("href=");
      expect(html).toContain("klik saya");
    });

    it.each([
      ["referensi", "[klik saya][r]\n\n[r]: javascript:alert(1)"],
      ["referensi pendek", "[klik saya]\n\n[klik saya]: javascript:alert(1)"],
      ["entitas desimal", "[klik saya](&#106;avascript:alert(1))"],
      ["entitas heksadesimal", "[klik saya](&#x6A;avascript:alert(1))"],
      ["tab lewat entitas", "[klik saya](java&#x09;script:alert(1))"],
      ["autolink", "<javascript:alert(1)>"],
      ["gambar bersarang di link", "[![klik saya](https://x/b.svg)](javascript:alert(1))"],
    ])("tidak ada href berbahaya lewat %s", (_name, source) => {
      const html = render(source);
      expect(html).not.toMatch(/href="[^"]*script/i);
      expect(html).not.toMatch(/<a [^>]*href="(?!https?:|mailto:)/i);
      expect(html).not.toContain("<img");
    });

    it("gambar bersarang di link berbahaya tetap menyisakan teks gambar", () => {
      const html = render("[![klik saya](https://x/b.svg)](javascript:alert(1))");
      expect(html).toContain("klik saya");
      expect(html).not.toContain("javascript");
    });

    it("autolink aman tetap menjadi link", () => {
      const html = render("<https://aman.example/a>");
      expect(html).toContain('href="https://aman.example/a"');
    });
  });

  describe("gambar", () => {
    it("menjadi link, bukan <img>", () => {
      const html = render("![logo](https://x/y.png)");
      expect(html).not.toContain("<img");
      expect(html).toContain('href="https://x/y.png"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain("logo");
    });

    it("tanpa teks alternatif memakai URL sebagai teks link", () => {
      const html = render("![](https://x/y.png)");
      expect(html).toMatch(/<a [^>]*>https:\/\/x\/y\.png<\/a>/);
    });

    it("gambar referensi juga menjadi link", () => {
      const html = render("![logo][ref]\n\n[ref]: https://x/y.png");
      expect(html).not.toContain("<img");
      expect(html).toContain('href="https://x/y.png"');
    });

    it("gambar di dalam link tidak membuat link bersarang", () => {
      const html = render("[![lencana](https://x/b.svg)](https://y.io)");
      expect(html).not.toContain("<img");
      expect(html.match(/<a /g)).toHaveLength(1);
      expect(html).toContain('href="https://y.io"');
      expect(html).toContain("lencana");
    });

    it("gambar dengan URL berbahaya tidak menghasilkan href", () => {
      const html = render("![x](javascript:alert(1))");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("javascript");
      expect(html).not.toContain("href=");
      expect(html).toContain("x");
    });

    it("gambar data: tidak menjadi <img> atau href", () => {
      const html = render("![x](data:image/png;base64,AAAA)");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("data:");
    });
  });

  describe("tabel GFM", () => {
    const table = ["| kiri | tengah | kanan |", "| :--- | :----: | ----: |", "| a | b | c |"].join("\n");

    it("tanpa atribut style (meski kolom diratakan) dan dibungkus wadah overflow-x-auto", () => {
      const html = render(table);
      expect(html).toContain("<table");
      expect(html).not.toMatch(/<[a-z][^>]*\sstyle=/i);
      expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"[^>]*><table/);
    });
  });

  describe("blok kode", () => {
    it("dibungkus wadah overflow-x-auto", () => {
      const html = render("```js\nconst x = 1;\n```");
      expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"[^>]*><pre/);
      expect(html).toContain("const x = 1;");
    });

    it("isi blok kode yang mirip HTML di-escape", () => {
      const html = render("```\n<script>alert(1)</script>\n```");
      expect(html).not.toContain("<script");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  it("tidak pernah menghasilkan atribut style pada konten apa pun", () => {
    const html = render(
      ['# a', '', '<span style="color:red">x</span>', '', '| a | b |', '| :-: | -: |', '| 1 | 2 |', '', '```', 'x', '```', '', '- [x] tugas'].join("\n"),
    );
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle=/i);
  });

  describe("catatan kaki", () => {
    const source = "Teks[^1] dan[^lain].\n\n[^1]: Isi catatan.\n[^lain]: Catatan lain.";

    it("tidak dirender sebagai catatan kaki (spec tidak mendukungnya): tanpa id, label Inggris, atau tautan", () => {
      const html = render(source);
      expect(html).not.toContain("footnote");
      expect(html).not.toContain("Footnotes");
      expect(html).not.toMatch(/\sid="/);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("<sup");
    });

    it("tetap menampilkan isi sebagai teks agar tidak ada yang hilang", () => {
      const html = render(source);
      expect(html).toContain("[^1]");
      expect(html).toContain("Isi catatan.");
      expect(html).toContain("[^lain]");
      expect(html).toContain("Catatan lain.");
    });

    it("beberapa blok Markdown satu halaman tidak menghasilkan id ganda", () => {
      const html = render(source) + render(source);
      const ids = html.match(/\sid="[^"]*"/g) ?? [];
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it("daftar tugas GFM tampil tanpa elemen input aktif", () => {
    const html = render("- [x] selesai\n- [ ] belum");
    expect(html).toContain("selesai");
    expect(html).toContain("belum");
    expect(html).not.toMatch(/<input(?![^>]*disabled)/);
  });
});
