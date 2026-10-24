import { useEffect } from "react";
import { ApiError } from "./api";

interface Issue {
  path: readonly PropertyKey[];
  message: string;
}

type ParseResult<T> = { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };

interface Schema<T> {
  safeParse(input: unknown): ParseResult<T>;
}

/** Validasi dengan schema bersama; hasil gagal berupa pesan pertama per field. */
export function validate<T>(
  schema: Schema<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; fields: Record<string, string> } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  return { ok: false, fields };
}

/**
 * Memetakan error dari server ke state form. Error per field hanya dipakai jika form punya inputnya (`knownFields`);
 * sisanya (mis. kunci "form") jatuh ke error umum agar tidak hilang.
 */
export function serverErrorToForm(
  err: unknown,
  knownFields: readonly string[],
): { fields: Record<string, string>; message: string | null } {
  if (!(err instanceof ApiError)) return { fields: {}, message: "Terjadi kesalahan. Coba lagi." };
  const fields: Record<string, string> = {};
  const orphans: string[] = [];
  for (const [key, message] of Object.entries(err.fields ?? {})) {
    if (knownFields.includes(key)) fields[key] = message;
    else orphans.push(message);
  }
  if (Object.keys(fields).length > 0) return { fields, message: null };
  return { fields, message: orphans[0] ?? err.message };
}

/** Pesan untuk pengguna: pesan dari server (sudah berbahasa Indonesia) atau pesan cadangan. */
export function errorMessage(err: unknown, fallback = "Terjadi kesalahan. Coba lagi."): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** Memindahkan fokus ke input pertama yang bermasalah agar pengguna keyboard/pembaca layar langsung sampai ke sana. */
export function focusField(form: HTMLFormElement | null, fields: Record<string, string>): void {
  const first = Object.keys(fields).find((name) => form?.elements.namedItem(name) instanceof HTMLElement);
  if (first) (form?.elements.namedItem(first) as HTMLElement).focus();
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · TestPulse`;
  }, [title]);
}
