import { describe, expect, it } from "vitest";
import { decodeCaseCursor, encodeCaseCursor } from "./cursor.js";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("cursor daftar case", () => {
  it.each([
    [0, 1],
    [3, 42],
    [199, 2_147_483_647],
  ])("round-trip posisi suite %i, nomor %i", (suitePosition, number) => {
    const cursor = encodeCaseCursor({ suitePosition, number });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCaseCursor(cursor)).toEqual({ suitePosition, number });
  });

  it.each([
    ["string kosong", ""],
    ["karakter di luar base64url", "abc$def"],
    ["padding base64 biasa", `${b64("c|1|2")}=`],
    ["tanpa pemisah", b64("c12")],
    ["terlalu banyak bagian", b64("c|1|2|3")],
    ["terlalu sedikit bagian", b64("c|1")],
    ["jenis tidak dikenal", b64("x|1|2")],
    ["posisi negatif", b64("c|-1|2")],
    ["nomor nol", b64("c|1|0")],
    ["nomor bukan angka", b64("c|1|a")],
    ["angka berawalan nol", b64("c|01|2")],
    ["nomor melebihi int4", b64("c|1|2147483648")],
    ["posisi melebihi int4", b64("c|2147483648|1")],
    ["sampah acak", "Zm9vYmFy"],
  ])("cursor rusak (%s) → null", (_label, cursor) => {
    expect(decodeCaseCursor(cursor)).toBeNull();
  });
});
