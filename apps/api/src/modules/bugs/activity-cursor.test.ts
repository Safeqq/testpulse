import { describe, expect, it } from "vitest";
import { decodeActivityCursor, encodeActivityCursor } from "./activity-cursor.js";

const UUID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const AT = "2026-11-04T08:15:30.123456Z";
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("cursor aktivitas bug", () => {
  it("round-trip komentar (uuid) dan event (bigint)", () => {
    for (const position of [
      { kind: "comment", at: AT, id: UUID },
      { kind: "event", at: AT, id: "9223372036854775807" },
    ] as const) {
      const cursor = encodeActivityCursor(position);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeActivityCursor(cursor)).toEqual(position);
    }
  });

  it.each([
    ["alfabet bukan base64url", "###"],
    ["bukan format cursor", b64("halo")],
    ["jenis tak dikenal", b64(`x|${AT}|1`)],
    ["waktu bukan mikrodetik", b64(`e|2026-11-04T08:15:30.123Z|1`)],
    ["tanggal tidak ada", b64(`e|2026-02-30T08:15:30.123456Z|1`)],
    ["id komentar bukan uuid", b64(`c|${AT}|12`)],
    ["id event bukan angka", b64(`e|${AT}|abc`)],
    ["id event berawalan nol", b64(`e|${AT}|007`)],
    ["id event di atas bigint", b64(`e|${AT}|9223372036854775808`)],
    ["bagian berlebih", b64(`e|${AT}|1|2`)],
  ])("menolak %s", (_label, cursor) => {
    expect(decodeActivityCursor(cursor)).toBeNull();
  });
});
