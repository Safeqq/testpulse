import { describe, expect, it } from "vitest";
import { acceptanceRate, compareLeaderboardRows, pointsFor, rankLeaderboard, type LeaderboardRow } from "./reputation.js";

describe("pointsFor", () => {
  it("minor 1, major 3, critical 5, blocker 8", () => {
    expect([pointsFor("minor"), pointsFor("major"), pointsFor("critical"), pointsFor("blocker")]).toEqual([1, 3, 5, 8]);
  });
});

describe("acceptanceRate", () => {
  it("diterima / (diterima + ditolak + duplikat)", () => {
    expect(acceptanceRate({ accepted: 12, rejected: 2, duplicate: 1 })).toBe(0.8);
  });

  it("tanpa keputusan → null", () => {
    expect(acceptanceRate({ accepted: 0, rejected: 0, duplicate: 0 })).toBeNull();
  });

  it("semua ditolak → 0", () => {
    expect(acceptanceRate({ accepted: 0, rejected: 3, duplicate: 0 })).toBe(0);
  });
});

const row = (userId: string, points: number, accepted: number, reachedAt: string, name = userId): LeaderboardRow => ({
  userId,
  name,
  points,
  accepted,
  reachedAt: new Date(reachedAt),
});

describe("rankLeaderboard", () => {
  it("urut poin ↓, jumlah diterima ↓, waktu mencapai poin ↑", () => {
    const board = rankLeaderboard(
      [
        row("c", 5, 1, "2026-11-03T00:00:00Z"),
        row("a", 8, 1, "2026-11-05T00:00:00Z"),
        row("b", 5, 2, "2026-11-04T00:00:00Z"),
        row("d", 5, 1, "2026-11-01T00:00:00Z"),
      ],
      null,
      50,
    );
    expect(board.entries.map((e) => [e.rank, e.user.id])).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "d"],
      [4, "c"],
    ]);
    expect(board.me).toBeNull();
  });

  it("entri berpoin 0 dibuang", () => {
    const board = rankLeaderboard([row("a", 0, 0, "2026-11-01T00:00:00Z"), row("b", 1, 1, "2026-11-01T00:00:00Z")], "a", 50);
    expect(board.entries.map((e) => e.user.id)).toEqual(["b"]);
    expect(board.me).toBeNull();
  });

  it("dipotong ke ukuran; me di luar top tetap dikembalikan dengan rank aslinya", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`u${i}`, 100 - i, 1, "2026-11-01T00:00:00Z"));
    const board = rankLeaderboard(rows, "u55", 50);
    expect(board.entries).toHaveLength(50);
    expect(board.entries[49]?.rank).toBe(50);
    expect(board.me).toMatchObject({ rank: 56, user: { id: "u55" }, points: 45 });
  });

  it("me di dalam top juga terisi", () => {
    const board = rankLeaderboard([row("a", 3, 1, "2026-11-01T00:00:00Z")], "a", 50);
    expect(board.me).toEqual({ rank: 1, user: { id: "a", name: "a" }, points: 3, accepted: 1 });
  });

  it("seri penuh diurutkan stabil berdasarkan id agar deterministik", () => {
    const board = rankLeaderboard([row("b", 3, 1, "2026-11-01T00:00:00Z"), row("a", 3, 1, "2026-11-01T00:00:00Z")], null, 50);
    expect(board.entries.map((e) => e.user.id)).toEqual(["a", "b"]);
  });

  it("me null tidak cocok dengan entri mana pun", () => {
    expect(rankLeaderboard([row("a", 3, 1, "2026-11-01T00:00:00Z")], null, 50).me).toBeNull();
  });
});

// Engine sort V8 hanya melihat apakah hasil comparator negatif, jadi beda 0 dan 1 tidak terlihat lewat rankLeaderboard;
// kontrak comparator konsisten (ECMAScript: urutan tak terdefinisi tanpanya) diuji langsung.
describe("compareLeaderboardRows", () => {
  const at = "2026-11-01T00:00:00Z";
  const pairs: [string, LeaderboardRow, LeaderboardRow][] = [
    ["poin lebih besar", row("z", 5, 1, at), row("a", 3, 9, "2026-10-01T00:00:00Z")],
    ["poin sama, diterima lebih banyak", row("z", 5, 2, at), row("a", 5, 1, "2026-10-01T00:00:00Z")],
    ["poin dan diterima sama, lebih dulu", row("z", 5, 1, "2026-10-01T00:00:00Z"), row("a", 5, 1, at)],
    ["seri sampai waktu, id lebih kecil", row("a", 5, 1, at), row("b", 5, 1, at)],
  ];

  it.each(pairs)("%s: negatif, dan positif bila ditukar", (_, first, second) => {
    expect(compareLeaderboardRows(first, second)).toBeLessThan(0);
    expect(compareLeaderboardRows(second, first)).toBeGreaterThan(0);
  });

  it("baris yang setara penuh → 0", () => {
    expect(compareLeaderboardRows(row("a", 5, 1, at), row("a", 5, 1, at, "nama lain"))).toBe(0);
  });
});
