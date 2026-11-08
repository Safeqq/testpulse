import { describe, expect, it } from "vitest";
import {
  decodeCaseCursor,
  decodeRunCaseCursor,
  decodeRunCursor,
  encodeCaseCursor,
  encodeRunCaseCursor,
  encodeRunCursor,
} from "./cursor.js";

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

describe("cursor daftar run dan run case", () => {
  it.each([1, 25, 2_147_483_647])("round-trip nomor run %i", (number) => {
    expect(decodeRunCursor(encodeRunCursor(number))).toBe(number);
  });

  it.each([0, 99, 2_147_483_647])("round-trip posisi run case %i", (position) => {
    expect(decodeRunCaseCursor(encodeRunCaseCursor(position))).toBe(position);
  });

  it("cursor daftar lain tidak diterima", () => {
    expect(decodeRunCursor(encodeRunCaseCursor(3))).toBeNull();
    expect(decodeRunCaseCursor(encodeRunCursor(3))).toBeNull();
    expect(decodeRunCursor(encodeCaseCursor({ suitePosition: 0, number: 1 }))).toBeNull();
  });

  it.each([
    ["string kosong", ""],
    ["karakter di luar base64url", "abc$def"],
    ["nomor nol", b64("r|0")],
    ["nomor negatif", b64("r|-1")],
    ["berawalan nol", b64("r|01")],
    ["melebihi int4", b64("r|2147483648")],
    ["bagian berlebih", b64("r|1|2")],
    ["bukan angka", b64("r|a")],
  ])("cursor run rusak (%s) → null", (_label, cursor) => {
    expect(decodeRunCursor(cursor)).toBeNull();
  });

  it.each([
    ["posisi negatif", b64("rc|-1")],
    ["berawalan nol", b64("rc|00")],
    ["melebihi int4", b64("rc|2147483648")],
    ["tanpa nilai", b64("rc|")],
  ])("cursor run case rusak (%s) → null", (_label, cursor) => {
    expect(decodeRunCaseCursor(cursor)).toBeNull();
  });
});
