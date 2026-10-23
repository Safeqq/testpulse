import { describe, expect, it } from "vitest";
import { SESSION_TTL_DAYS, generateToken, hashToken } from "./tokens.js";

describe("tokens", () => {
  it("TTL sesi 14 hari", () => {
    expect(SESSION_TTL_DAYS).toBe(14);
  });

  it("generateToken: base64url, panjang >= 43, unik", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });

  it("hashToken: deterministik, 64 hex", () => {
    const h = hashToken("token-contoh");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("token-contoh")).toBe(h);
    expect(hashToken("token-lain")).not.toBe(h);
  });

  it("hashToken: nilai SHA-256 yang diketahui", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
