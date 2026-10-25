import { describe, expect, it } from "vitest";
import { redactUrl, serializeError, serializeRequest } from "./logging.js";

describe("redactUrl", () => {
  it("menyensor segmen token pada pratinjau dan accept, mempertahankan sisanya", () => {
    expect(redactUrl("/api/v1/invitations/abc_DEF-123")).toBe("/api/v1/invitations/[REDACTED]");
    expect(redactUrl("/api/v1/invitations/abc_DEF-123/accept")).toBe("/api/v1/invitations/[REDACTED]/accept");
    expect(redactUrl("/api/v1/invitations/abc?x=1")).toBe("/api/v1/invitations/[REDACTED]?x=1");
  });

  it("tidak menyentuh URL lain, termasuk id undangan di path project", () => {
    for (const url of [
      "/api/v1/projects/demo/invitations/11111111-1111-4111-8111-111111111111",
      "/api/v1/projects/demo/invitations",
      "/api/v1/invitations",
      "/api/health",
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });
});

describe("serializeRequest", () => {
  it("mempertahankan field request lain dan menyensor url", () => {
    const out = serializeRequest({
      method: "POST",
      url: "/api/v1/invitations/rahasia/accept",
      headers: { "accept-version": "1.0.0" },
      host: "localhost",
      ip: "127.0.0.1",
    });
    expect(out).toEqual({
      method: "POST",
      url: "/api/v1/invitations/[REDACTED]/accept",
      version: "1.0.0",
      host: "localhost",
      remoteAddress: "127.0.0.1",
      remotePort: undefined,
    });
  });
});

describe("serializeError", () => {
  class DrizzleQueryError extends Error {
    constructor(
      message: string,
      readonly query: string,
      readonly params: unknown[],
      cause?: Error,
    ) {
      super(message, { cause });
    }
  }

  /** Meniru DrizzleQueryError (drizzle-orm 0.45): params ikut di message, stack, dan properti enumerable. */
  function drizzleLikeError(): Error {
    const query = 'insert into "users" ("email", "password_hash") values ($1, $2)';
    const params = ["budi@example.test", "aabbccdd:11223344"];
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
      code: "23505",
    });
    const err = new DrizzleQueryError(`Failed query: ${query}\nparams: ${params.join(",")}`, query, params, cause);
    err.stack = `Error: ${err.message}\n    at createUser (repository.ts:23:17)\n    at register (service.ts:48:16)`;
    return err;
  }

  it("error dengan params: hanya name, query tanpa nilai, penyebab (code, message), dan frame stack", () => {
    const out = serializeError(drizzleLikeError());
    expect(out.type).toBe("DrizzleQueryError");
    expect(out.message).toBe('Failed query: insert into "users" ("email", "password_hash") values ($1, $2)');
    expect(out.cause).toMatchObject({ code: "23505", message: expect.stringContaining("users_email_key") });
    expect(out.stack).toContain("at createUser (repository.ts:23:17)");
    expect(out).not.toHaveProperty("params");
    expect(out).not.toHaveProperty("query");
    const json = JSON.stringify(out);
    expect(json).not.toContain("budi@example.test");
    expect(json).not.toContain("aabbccdd:11223344");
    expect(json).not.toContain("params:");
  });

  it("error tanpa properti params tetapi message memuat 'params:' tetap disensor", () => {
    const err = new Error("Failed query: select 1\nparams: rahasia");
    const json = JSON.stringify(serializeError(err));
    expect(json).not.toContain("rahasia");
    expect(JSON.parse(json).message).toBe("Failed query: select 1");
  });

  it("error biasa tidak diubah: type, message, stack, code, statusCode, dan cause", () => {
    const err = Object.assign(new Error("gagal biasa", { cause: new Error("akar masalah") }), {
      code: "E_X",
      statusCode: 502,
    });
    const out = serializeError(err);
    expect(out).toMatchObject({ type: "Error", message: "gagal biasa", stack: err.stack, code: "E_X", statusCode: 502 });
    expect(out.cause).toMatchObject({ type: "Error", message: "akar masalah" });
  });

  it("nilai yang bukan Error dikembalikan apa adanya", () => {
    expect(serializeError("teks" as unknown as Error)).toBe("teks");
    expect(serializeError(undefined as unknown as Error)).toBeUndefined();
  });
});
