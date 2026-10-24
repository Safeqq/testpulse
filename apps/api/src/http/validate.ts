import type { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Memvalidasi `data` dengan skema Zod. Jika gagal, melempar
 * `AppError(400, "VALIDATION_ERROR")` dengan `fields` = path bertitik → pesan pertama.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
    fields[key] ??= issue.message;
  }
  throw new AppError(400, "VALIDATION_ERROR", "Data tidak valid", fields);
}
