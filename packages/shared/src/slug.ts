import { z } from "zod";

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RESERVED_SLUGS = ["api", "new", "settings", "invite", "login", "register"] as const;

// Stryker disable next-line Regex: slugify first collapses every run of separators into one "-", so the string has at most one dash at each end and "-+" behaves exactly like "-". Also hidden: the two anchor-removal variants (/-+|-+$/g, /^-+|-+/g), which the slugify tests kill but cannot be disabled separately.
const EDGE_DASHES = /^-+|-+$/g;
const SLUG_MIN = 3;
const SLUG_MAX = 40;

/** Membuat slug dari nama: huruf kecil, diakritik dibuang, selain a-z0-9 jadi "-", maks 40 karakter. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(EDGE_DASHES, "");
}

export const slugSchema = z
  .string()
  .min(SLUG_MIN, "Slug minimal 3 karakter")
  .max(SLUG_MAX, "Slug maksimal 40 karakter")
  .regex(SLUG_PATTERN, "Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung tunggal (tidak di awal/akhir)")
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), "Slug ini tidak boleh dipakai");
