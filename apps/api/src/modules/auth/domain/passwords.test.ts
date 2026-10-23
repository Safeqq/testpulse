import { describe, expect, it } from "vitest";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./passwords.js";

describe("passwords", () => {
  it("hash berbeda dari password dan berformat salt:hash hex", async () => {
    const hash = await hashPassword("rahasia-123");
    expect(hash).not.toBe("rahasia-123");
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]{128}$/);
  });

  it("verifikasi password benar -> true", async () => {
    const hash = await hashPassword("rahasia-123");
    expect(await verifyPassword("rahasia-123", hash)).toBe(true);
  });

  it("verifikasi password salah -> false", async () => {
    const hash = await hashPassword("rahasia-123");
    expect(await verifyPassword("salah-123", hash)).toBe(false);
  });

  it("dua hash dari password sama berbeda (salt acak)", async () => {
    const a = await hashPassword("rahasia-123");
    const b = await hashPassword("rahasia-123");
    expect(a).not.toBe(b);
  });

  it("stored rusak -> false", async () => {
    expect(await verifyPassword("rahasia-123", "abc")).toBe(false);
    expect(await verifyPassword("rahasia-123", "")).toBe(false);
    expect(await verifyPassword("rahasia-123", ":")).toBe(false);
  });

  it("hash dengan panjang tidak sesuai -> false (tanpa melempar)", async () => {
    expect(await verifyPassword("rahasia-123", "aabb:ccdd")).toBe(false);
  });

  it("burnPasswordCheck selalu false", async () => {
    expect(await burnPasswordCheck("apa-saja")).toBe(false);
  });
});
