import { describe, expect, it } from "vitest";
import { decodeCursor, decodeResultCursor, encodeCursor, encodeResultCursor } from "./cursor.js";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("cursor run (createdAt, id)", () => {
  it("round-trip mengembalikan createdAt dan id yang sama", () => {
    const createdAt = new Date("2026-10-28T08:15:30.123Z");
    const cursor = encodeCursor(createdAt, ID);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ createdAt, id: ID });
  });

  it.each(["0001-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z"])("batas tahun %s diterima", (iso) => {
    const createdAt = new Date(iso);
    expect(decodeCursor(encodeCursor(createdAt, ID))).toEqual({ createdAt, id: ID });
  });

  it.each([
    ["string kosong", ""],
    ["karakter di luar base64url", "abc$def"],
    ["padding base64 biasa", `${b64(`2026-10-28T08:15:30.123Z|${ID}`)}=`],
    ["tanpa pemisah", b64(`2026-10-28T08:15:30.123Z${ID}`)],
    ["terlalu banyak bagian", b64(`2026-10-28T08:15:30.123Z|${ID}|x`)],
    ["tanggal tidak valid", b64(`bukan-tanggal|${ID}`)],
    ["tanggal tidak kanonis", b64(`2026-10-28|${ID}`)],
    ["id bukan uuid", b64("2026-10-28T08:15:30.123Z|123")],
    ["tahun 0000 (ditolak Postgres)", b64(`0000-01-01T00:00:00.000Z|${ID}`)],
    ["tahun 6 digit positif", b64(`+010000-01-01T00:00:00.000Z|${ID}`)],
    ["tahun negatif", b64(`-000001-01-01T00:00:00.000Z|${ID}`)],
    ["sampah acak", "Zm9vYmFy"],
  ])("cursor rusak (%s) → null", (_label, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});

describe("cursor hasil test (id bigserial)", () => {
  it("round-trip mengembalikan id yang sama", () => {
    const cursor = encodeResultCursor(123456);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeResultCursor(cursor)).toBe(123456);
  });

  it.each([
    ["string kosong", ""],
    ["karakter di luar base64url", "12+3"],
    ["bukan angka", b64("abc")],
    ["nol", b64("0")],
    ["negatif", b64("-5")],
    ["nol di depan", b64("007")],
    ["melebihi safe integer", b64("9007199254740993")],
    ["cursor run", encodeCursor(new Date("2026-10-28T08:15:30.123Z"), ID)],
  ])("cursor rusak (%s) → null", (_label, cursor) => {
    expect(decodeResultCursor(cursor)).toBeNull();
  });
});
