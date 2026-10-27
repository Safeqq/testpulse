import { describe, expect, it } from "vitest";
import {
  applyTheme,
  parsePreference,
  readStoredPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredPreference,
  type ThemePreference,
} from "./theme";

describe("tema", () => {
  it("kunci penyimpanan adalah tp-theme", () => {
    expect(THEME_STORAGE_KEY).toBe("tp-theme");
  });

  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    ["blue", "system"],
    ["", "system"],
    [null, "system"],
    ['{"a":1}', "system"],
  ])("parsePreference(%j) = %s", (raw, exp) => expect(parsePreference(raw as string | null)).toBe(exp));

  it("parsePreference(undefined) = system", () => expect(parsePreference(undefined)).toBe("system"));

  it("readStoredPreference membaca kunci tp-theme", () => {
    const seen: string[] = [];
    const pref = readStoredPreference({
      getItem(key) {
        seen.push(key);
        return "dark";
      },
    });
    expect(seen).toEqual(["tp-theme"]);
    expect(pref).toBe("dark");
  });

  it("readStoredPreference: storage melempar error → system", () =>
    expect(
      readStoredPreference({
        getItem() {
          throw new Error("blocked");
        },
      }),
    ).toBe("system"));

  it("readStoredPreference: storage null → system", () => expect(readStoredPreference(null)).toBe("system"));

  it("writeStoredPreference menulis ke kunci tp-theme", () => {
    const written: Array<[string, string]> = [];
    writeStoredPreference({ setItem: (k, v) => void written.push([k, v]) }, "light");
    expect(written).toEqual([["tp-theme", "light"]]);
  });

  it("writeStoredPreference menelan error", () =>
    expect(() =>
      writeStoredPreference(
        {
          setItem() {
            throw new Error("quota");
          },
        },
        "dark",
      ),
    ).not.toThrow());

  it("writeStoredPreference: storage null tidak melempar", () =>
    expect(() => writeStoredPreference(null, "dark")).not.toThrow());

  it.each([
    ["system", true, "dark"],
    ["system", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
  ])("resolveTheme(%s, %s) = %s", (p, sys, exp) => expect(resolveTheme(p as ThemePreference, sys as boolean)).toBe(exp));

  it.each(["dark", "light"] as const)("applyTheme(%s) mengatur kelas dark dan color-scheme", (theme) => {
    const classes = new Set<string>(theme === "dark" ? [] : ["dark"]);
    const root = {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
          return Boolean(force);
        },
      } as unknown as DOMTokenList,
      style: { colorScheme: "" } as CSSStyleDeclaration,
    };
    applyTheme(root, theme);
    expect(classes.has("dark")).toBe(theme === "dark");
    expect(root.style.colorScheme).toBe(theme);
  });
});
