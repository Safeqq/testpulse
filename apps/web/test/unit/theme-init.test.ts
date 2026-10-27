import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { parsePreference, resolveTheme, THEME_COLORS } from "../../src/lib/theme";

// theme-init.js adalah JS biasa di public/ (dimuat sinkron di <head>, tidak bisa mengimpor TS), jadi
// perilakunya harus identik dengan theme.ts. Test ini menjalankan berkas aslinya di sandbox `node:vm`.
const script = readFileSync(fileURLToPath(new URL("../../public/theme-init.js", import.meta.url)), "utf8");

type Stored = string | null | "throws";

function runInit(stored: Stored, systemDark: boolean) {
  const classes = new Set<string>();
  const root = {
    classList: {
      toggle(name: string, force?: boolean) {
        if (force) classes.add(name);
        else classes.delete(name);
        return Boolean(force);
      },
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
    },
    style: { colorScheme: "" },
  };
  const window = {
    localStorage: {
      getItem(key: string) {
        if (stored === "throws") throw new Error("blocked");
        return key === "tp-theme" ? stored : null;
      },
    },
    matchMedia: (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" && systemDark }),
  };
  // Elemen <meta name="theme-color"> palsu: hanya selector yang tepat yang mengembalikannya.
  const meta = { content: "#f4f5f7", setAttribute(name: string, value: string) { if (name === "content") this.content = value; } };
  const document = {
    documentElement: root,
    querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null),
  };
  const sandbox = { window, document, localStorage: window.localStorage, matchMedia: window.matchMedia };
  vm.runInNewContext(script, sandbox);
  return { dark: classes.has("dark"), colorScheme: root.style.colorScheme, themeColor: meta.content };
}

describe("public/theme-init.js", () => {
  const stored: Stored[] = ["dark", "light", "system", "blue", null, "throws"];
  const cases = stored.flatMap((s) => [true, false].map((sys) => [s, sys] as const));

  it.each(cases)("tp-theme=%j, sistem gelap=%s sama dengan resolveTheme(parsePreference(...))", (s, systemDark) => {
    // getItem yang melempar diperlakukan sebagai "system" (lihat readStoredPreference).
    const expected = resolveTheme(parsePreference(s === "throws" ? null : s), systemDark);
    const result = runInit(s, systemDark);
    expect(result.dark).toBe(expected === "dark");
    expect(result.colorScheme).toBe(expected);
    // Chrome browser (address bar) harus sudah gelap sebelum React dimuat.
    expect(result.themeColor).toBe(THEME_COLORS[expected]);
  });

  it("tetap menerapkan tema bila matchMedia tidak tersedia", () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
          return Boolean(force);
        },
        add: (name: string) => void classes.add(name),
        remove: (name: string) => void classes.delete(name),
      },
      style: { colorScheme: "" },
    };
    const window = { localStorage: { getItem: () => "dark" } };
    vm.runInNewContext(script, { window, document: { documentElement: root }, localStorage: window.localStorage });
    expect(classes.has("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });
});
