import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration, formatPassRate, formatRelativeTime } from "./format";

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

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-11-05T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("kurang dari semenit (termasuk jam yang sedikit di depan) menjadi 'baru saja'", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("baru saja");
    expect(formatRelativeTime(ago(59_000), now)).toBe("baru saja");
    expect(formatRelativeTime(ago(-30_000), now)).toBe("baru saja");
  });

  it("memakai menit, jam, dan hari", () => {
    expect(formatRelativeTime(ago(MINUTE), now)).toBe("1 menit lalu");
    expect(formatRelativeTime(ago(59 * MINUTE), now)).toBe("59 menit lalu");
    expect(formatRelativeTime(ago(2 * HOUR + 30 * MINUTE), now)).toBe("2 jam lalu");
    expect(formatRelativeTime(ago(23 * HOUR), now)).toBe("23 jam lalu");
    expect(formatRelativeTime(ago(DAY), now)).toBe("1 hari lalu");
    expect(formatRelativeTime(ago(29 * DAY), now)).toBe("29 hari lalu");
  });

  it("lebih dari 30 hari menjadi tanggal; nilai bukan tanggal dikembalikan apa adanya", () => {
    expect(formatRelativeTime(ago(40 * DAY), now)).toBe(formatDateTime(ago(40 * DAY)));
    expect(formatRelativeTime("bukan tanggal", now)).toBe("bukan tanggal");
  });
});
