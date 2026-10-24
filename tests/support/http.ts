import { expect, type APIResponse } from "@playwright/test";
import type { ApiErrorBody, ErrorCode } from "@testpulse/shared";

/** Header keamanan yang harus ada di setiap respons API (helmet). */
export function expectSecurityHeaders(res: APIResponse): void {
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
}

/** Memeriksa status, lalu mem-parse body JSON dengan schema shared. */
export async function parseBody<T>(res: APIResponse, status: number, schema: { parse(data: unknown): T }): Promise<T> {
  expect(res.status(), await res.text()).toBe(status);
  expectSecurityHeaders(res);
  return schema.parse(await res.json());
}

/** Memeriksa respons error: status, bentuk `{ error: { code, message } }`, dan (opsional) `fields`. */
export async function expectApiError(
  res: APIResponse,
  status: number,
  code: ErrorCode,
): Promise<ApiErrorBody["error"]> {
  const text = await res.text();
  expect(res.status(), text).toBe(status);
  expectSecurityHeaders(res);
  const body = JSON.parse(text) as ApiErrorBody;
  expect(Object.keys(body)).toEqual(["error"]);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toEqual(expect.any(String));
  if (code === "VALIDATION_ERROR") {
    expect(body.error.fields ?? {}).toEqual(expect.any(Object));
  } else {
    expect(body.error.fields).toBeUndefined();
  }
  return body.error;
}

/** Respons 400 VALIDATION_ERROR yang memuat pesan untuk field `field`. */
export async function expectFieldError(res: APIResponse, field: string): Promise<void> {
  const error = await expectApiError(res, 400, "VALIDATION_ERROR");
  expect(error.fields?.[field], `fields.${field}`).toEqual(expect.any(String));
}

/** Token undangan = segmen terakhir dari `url` yang dikembalikan saat undangan dibuat. */
export function tokenFromUrl(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}
