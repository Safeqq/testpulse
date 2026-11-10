import { scrypt, scryptSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./passwords.js";

// scrypt asli tetap dipakai; spy hanya untuk memastikan burnPasswordCheck benar-benar menjalankannya (penyetaraan
// waktu) dan untuk mensimulasikan error.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});

type ScryptCallback = (err: Error | null, key: Buffer) => void;

/** `salt:hash` yang valid untuk `password` dengan salt tertentu (bisa kosong). */
const storedFor = (password: string, salt: Buffer) => `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
const keyHex = (password: string, salt: Buffer) => scryptSync(password, salt, 64).toString("hex");

beforeEach(() => {
  vi.mocked(scrypt).mockClear();
});

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

  it("burnPasswordCheck benar-benar menjalankan scrypt (salt 16 byte, kunci 64 byte) agar waktunya setara", async () => {
    await burnPasswordCheck("apa-saja");
    expect(scrypt).toHaveBeenCalledTimes(1);
    const [password, salt, keyLength] = vi.mocked(scrypt).mock.calls[0]!;
    expect(password).toBe("apa-saja");
    expect(salt).toEqual(Buffer.alloc(16));
    expect(keyLength).toBe(64);
  });

  it("segmen tambahan setelah hash -> false walau salt dan hash cocok", async () => {
    const hash = await hashPassword("rahasia-123");
    expect(await verifyPassword("rahasia-123", hash)).toBe(true);
    expect(await verifyPassword("rahasia-123", `${hash}:00`)).toBe(false);
  });

  // Buffer.from(hex) berhenti di karakter non-hex pertama: tanpa cek format, isian berikut akan lolos sebagai
  // salt/hash yang terpotong. Hash di bawah dibuat agar cocok dengan hasil potongan itu.
  it("salt dengan karakter non-hex di depan -> false (potongannya salt kosong yang cocok)", async () => {
    expect(await verifyPassword("rahasia-123", `zz00:${keyHex("rahasia-123", Buffer.alloc(0))}`)).toBe(false);
  });

  it("salt dengan karakter non-hex di belakang -> false (potongannya salt 00 yang cocok)", async () => {
    expect(await verifyPassword("rahasia-123", `00zz:${keyHex("rahasia-123", Buffer.from([0]))}`)).toBe(false);
  });

  it("hash dengan karakter non-hex di belakang -> false (potongannya hash 64 byte yang cocok)", async () => {
    const stored = storedFor("rahasia-123", Buffer.from("0123456789abcdef", "hex"));
    expect(await verifyPassword("rahasia-123", stored)).toBe(true);
    expect(await verifyPassword("rahasia-123", `${stored}zz`)).toBe(false);
  });

  it("error dari scrypt diteruskan sebagai rejection", async () => {
    vi.mocked(scrypt).mockImplementationOnce(((...args: unknown[]) => {
      (args.at(-1) as ScryptCallback)(new Error("scrypt gagal"), Buffer.alloc(0));
    }) as typeof scrypt);
    await expect(hashPassword("rahasia-123")).rejects.toThrow("scrypt gagal");
  });
});
