import { describe, expect, it } from "vitest";
import { decodeBugCursor, encodeBugCursor } from "./cursor.js";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const AT = "2026-11-04T08:15:30.123456Z";
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("cursor daftar bug", () => {
  it.each(["updated", "created"] as const)("round-trip sort=%s mengembalikan posisi yang sama", (sort) => {
    const cursor = encodeBugCursor(sort, { at: AT, id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBugCursor(cursor, sort)).toEqual({ at: AT, id: ID });
  });

  it.each([1, 2, 3, 4])("round-trip sort=priority dengan peringkat %i", (rank) => {
    const cursor = encodeBugCursor("priority", { at: AT, id: ID, rank });
    expect(decodeBugCursor(cursor, "priority")).toEqual({ at: AT, id: ID, rank });
  });

  it.each(["0001-01-01T00:00:00.000000Z", "9999-12-31T23:59:59.999999Z"])("batas tahun %s diterima", (at) => {
    expect(decodeBugCursor(encodeBugCursor("updated", { at, id: ID }), "updated")).toEqual({ at, id: ID });
  });

  it("cursor dari urutan lain ditolak (posisi tidak bermakna untuk urutan ini)", () => {
    const updated = encodeBugCursor("updated", { at: AT, id: ID });
    expect(decodeBugCursor(updated, "created")).toBeNull();
    expect(decodeBugCursor(updated, "priority")).toBeNull();
    expect(decodeBugCursor(encodeBugCursor("priority", { at: AT, id: ID, rank: 2 }), "updated")).toBeNull();
  });

  it.each([
    ["string kosong", ""],
    ["karakter di luar base64url", "abc$def"],
    ["padding base64 biasa", `${b64(`u|${AT}|${ID}`)}=`],
    ["tanpa pemisah", b64(`u${AT}${ID}`)],
    ["terlalu banyak bagian", b64(`u|${AT}|${ID}|x`)],
    ["jenis urutan tidak dikenal", b64(`x|${AT}|${ID}`)],
    ["presisi milidetik (bukan mikrodetik)", b64(`u|2026-11-04T08:15:30.123Z|${ID}`)],
    ["tanggal tidak valid", b64(`u|2026-02-30T08:15:30.123456Z|${ID}`)],
    ["jam tidak valid", b64(`u|2026-11-04T25:15:30.123456Z|${ID}`)],
    ["tahun 0000", b64(`u|0000-01-01T00:00:00.000000Z|${ID}`)],
    ["tahun 6 digit", b64(`u|+010000-01-01T00:00:00.000000Z|${ID}`)],
    ["id bukan uuid", b64(`u|${AT}|123`)],
    ["sampah acak", "Zm9vYmFy"],
  ])("cursor rusak (%s) → null", (_label, cursor) => {
    expect(decodeBugCursor(cursor, "updated")).toBeNull();
  });

  it.each([
    ["peringkat hilang", b64(`p|${AT}|${ID}`)],
    ["peringkat 0", b64(`p|0|${AT}|${ID}`)],
    ["peringkat 5", b64(`p|5|${AT}|${ID}`)],
    ["peringkat bukan angka", b64(`p|a|${AT}|${ID}`)],
    ["peringkat berawalan nol", b64(`p|02|${AT}|${ID}`)],
  ])("cursor prioritas rusak (%s) → null", (_label, cursor) => {
    expect(decodeBugCursor(cursor, "priority")).toBeNull();
  });
});
