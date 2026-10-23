import { z } from "zod";

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RESERVED_SLUGS = ["api", "new", "settings", "invite", "login", "register"] as const;

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
    .replace(/^-+|-+$/g, "");
}

export const slugSchema = z
  .string()
  .min(SLUG_MIN, "Slug minimal 3 karakter")
  .max(SLUG_MAX, "Slug maksimal 40 karakter")
  .regex(SLUG_PATTERN, "Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung tunggal (tidak di awal/akhir)")
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), "Slug ini tidak boleh dipakai");
