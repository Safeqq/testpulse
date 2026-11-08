import { describe, expect, it } from "vitest";
import { moveItem } from "./order.js";

describe("moveItem", () => {
  const items = ["a", "b", "c", "d"];

  it("memindahkan dari awal ke akhir", () => {
    expect(moveItem(items, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("memindahkan dari akhir ke awal", () => {
    expect(moveItem(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("memindahkan ke tengah", () => {
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("membatasi `to` ke rentang daftar", () => {
    expect(moveItem(items, 2, -1)).toEqual(["c", "a", "b", "d"]);
    expect(moveItem(items, 1, 99)).toEqual(["a", "c", "d", "b"]);
  });

  it("`from` di luar rentang mengembalikan salinan apa adanya", () => {
    for (const from of [-1, 4, 99]) {
      const result = moveItem(items, from, 1);
      expect(result).toEqual(items);
      expect(result).not.toBe(items);
    }
  });

  it("daftar satu elemen", () => {
    expect(moveItem(["x"], 0, 0)).toEqual(["x"]);
    expect(moveItem(["x"], 0, 5)).toEqual(["x"]);
  });

  it("daftar kosong", () => {
    expect(moveItem([], 0, 0)).toEqual([]);
  });

  it("tidak mengubah daftar sumber", () => {
    const source = ["a", "b", "c"];
    moveItem(source, 0, 2);
    expect(source).toEqual(["a", "b", "c"]);
  });
});
