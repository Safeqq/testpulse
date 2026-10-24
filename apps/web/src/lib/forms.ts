import { useEffect } from "react";

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
