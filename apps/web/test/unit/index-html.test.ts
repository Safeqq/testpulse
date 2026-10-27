import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// theme-init.js hanya mencegah kedip tema bila dimuat sebagai skrip klasik yang SINKRON di <head>, sebelum bundle.
// Test E2E "tanpa kedip" menangkap regresinya di browser; ini penjaga statis yang murah untuk pemicunya.
const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

function scriptTags(source: string): Array<{ tag: string; index: number }> {
  return [...source.matchAll(/<script\b[^>]*>/gi)].map((match) => ({ tag: match[0], index: match.index ?? 0 }));
}

describe("index.html", () => {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);

  it("memuat theme-init.js sebagai skrip klasik sinkron di <head>", () => {
    expect(head, "<head> ditemukan").not.toBeNull();
    const inHead = scriptTags(head?.[1] ?? "").filter(({ tag }) => /\bsrc=["']\/theme-init\.js["']/.test(tag));
    expect(inHead).toHaveLength(1);
    const tag = inHead[0]?.tag ?? "";
    expect(tag).not.toMatch(/\b(defer|async)\b/i);
    expect(tag).not.toMatch(/\btype\s*=/i);
  });

  it("memuat theme-init.js sebelum skrip module aplikasi", () => {
    const scripts = scriptTags(html);
    const init = scripts.find(({ tag }) => tag.includes("/theme-init.js"));
    const entry = scripts.find(({ tag }) => /\btype=["']module["']/i.test(tag));
    expect(init, "skrip theme-init").toBeDefined();
    expect(entry, "skrip module").toBeDefined();
    expect(init?.index ?? Infinity).toBeLessThan(entry?.index ?? -1);
  });

  it("menyediakan <meta name=theme-color> yang diperbarui oleh theme-init.js", () => {
    expect(html).toMatch(/<meta\s+name=["']theme-color["']/i);
  });
});
