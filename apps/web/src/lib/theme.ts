export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "tp-theme";

/** Warna `<meta name="theme-color">` per tema (sama dengan latar halaman). */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#f4f5f7", dark: "#0b0d0f" };

/**
 * Logika ini direplikasi di `public/theme-init.js` (skrip klasik yang dimuat sinkron di <head>, tidak bisa
 * mengimpor TS). Test unit `theme-init.test.ts` menjaga keduanya tetap identik.
 */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function readStoredPreference(storage: Pick<Storage, "getItem"> | null): ThemePreference {
  try {
    return parsePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    // Penyimpanan diblokir (mode privat, kebijakan browser): perlakukan sebagai "system".
    return "system";
  }
}

export function writeStoredPreference(storage: Pick<Storage, "setItem"> | null, pref: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Gagal menyimpan (diblokir / kuota): pilihan tetap berlaku untuk sesi ini.
  }
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

export function applyTheme(root: { classList: DOMTokenList; style: CSSStyleDeclaration }, theme: ResolvedTheme): void {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}
