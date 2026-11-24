import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, INT, TIME, UUID } from "./cursor.js";

describe("cursor crowd", () => {
  const id = "0b6c1e8e-6a3f-4c7e-9a51-6a4f3d2b1c00";

  it("bolak-balik untuk nomor, waktu, dan uuid", () => {
    const at = new Date("2026-11-16T10:00:00.123Z");
    const cursor = encodeCursor("pa", [at.getTime(), id]);
    expect(decodeCursor("pa", cursor, [TIME, UUID])).toEqual([at.getTime(), id]);
    expect(decodeCursor("cy", encodeCursor("cy", [42]), [INT])).toEqual([42]);
  });

  it("tag lain ditolak (cursor daftar satu tidak berlaku di daftar lain)", () => {
    expect(decodeCursor("cy", encodeCursor("pa", [42]), [INT])).toBeNull();
  });

  it.each(["", "rusak!", "a b", "==", Buffer.from("cy|01").toString("base64url"), Buffer.from("cy|-1").toString("base64url")])(
    "%j ditolak",
    (raw) => {
      expect(decodeCursor("cy", raw, [INT])).toBeNull();
    },
  );

  it("jumlah bagian harus cocok", () => {
    expect(decodeCursor("cy", encodeCursor("cy", [1, 2]), [INT])).toBeNull();
  });

  it("nomor di atas int4 ditolak", () => {
    expect(decodeCursor("cy", Buffer.from("cy|2147483648").toString("base64url"), [INT])).toBeNull();
    expect(decodeCursor("cy", Buffer.from("cy|2147483647").toString("base64url"), [INT])).toEqual([2147483647]);
  });

  it("uuid tidak sah ditolak", () => {
    expect(decodeCursor("pa", encodeCursor("pa", [1, "bukan-uuid"]), [TIME, UUID])).toBeNull();
  });

  it("waktu boleh 0 dan besar, tetapi tidak negatif atau desimal", () => {
    expect(decodeCursor("t", encodeCursor("t", [0]), [TIME])).toEqual([0]);
    expect(decodeCursor("t", Buffer.from("t|1.5").toString("base64url"), [TIME])).toBeNull();
  });
});
