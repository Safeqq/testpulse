import { describe, expect, it } from "vitest";
import { slugSchema, slugify } from "./slug.js";

describe("slugify", () => {
  it.each([
    ["Proyek Saya", "proyek-saya"],
    ["  TestPulse  QA!! ", "testpulse-qa"],
    ["Café Ünïcode", "cafe-unicode"], // diakritik dibuang (NFKD)
    ["a".repeat(50), "a".repeat(40)],
    ["x---y", "x-y"],
  ])("slugify(%j) = %j", (input, out) => expect(slugify(input)).toBe(out));

  it("slugify tidak menghasilkan '-' di ujung setelah dipotong", () =>
    expect(slugify("a".repeat(39) + " b")).toBe("a".repeat(39)));

  it("slugify karakter non-latin → string kosong", () => expect(slugify("测试")).toBe(""));
});

describe("slugSchema", () => {
  it.each(["ab", "a".repeat(41), "-abc", "abc-", "a--b", "ABC", "api", "settings"])(
    "menolak %j",
    (s) => expect(slugSchema.safeParse(s).success).toBe(false),
  );

  it.each(["abc", "a".repeat(40), "qa-2026"])("menerima %j", (s) =>
    expect(slugSchema.safeParse(s).success).toBe(true),
  );
});
