import { describe, expect, it } from "vitest";
import { formatDuration, formatPassRate } from "./format";

describe("formatDuration", () => {
  it("memakai milidetik di bawah satu detik", () => {
    expect(formatDuration(0)).toBe("0 md");
    expect(formatDuration(420)).toBe("420 md");
  });

  it("memakai detik dengan satu desimal di bawah semenit", () => {
    expect(formatDuration(1200)).toBe("1,2 dtk");
    expect(formatDuration(30000)).toBe("30 dtk");
  });

  it("membulatkan total detik lebih dulu agar tidak muncul 60 dtk", () => {
    expect(formatDuration(59960)).toBe("1 mnt");
    expect(formatDuration(119700)).toBe("2 mnt");
  });

  it("memecah menit dan detik", () => {
    expect(formatDuration(60000)).toBe("1 mnt");
    expect(formatDuration(125000)).toBe("2 mnt 5 dtk");
  });
});

describe("formatPassRate", () => {
  it("memakai koma desimal id-ID dan membuang desimal nol", () => {
    expect(formatPassRate(100)).toBe("100%");
    expect(formatPassRate(66.7)).toBe("66,7%");
  });

  it("menampilkan tanda hubung bila tidak ada pass rate", () => {
    expect(formatPassRate(null)).toBe("–");
  });
});
