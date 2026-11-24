import { SEVERITY_POINTS, type CrowdSeverity, type LeaderboardDto, type LeaderboardEntryDto } from "@testpulse/shared";

// Spec Tahap 5 §6: poin, tingkat penerimaan, dan leaderboard.

export function pointsFor(severity: CrowdSeverity): number {
  return SEVERITY_POINTS[severity];
}

/** Diterima / (diterima + ditolak + duplikat); `null` bila belum ada keputusan. Ditarik dan `submitted` diabaikan. */
export function acceptanceRate(counts: { accepted: number; rejected: number; duplicate: number }): number | null {
  const decided = counts.accepted + counts.rejected + counts.duplicate;
  return decided === 0 ? null : counts.accepted / decided;
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  points: number;
  accepted: number;
  /** Waktu laporan diterima terakhir (saat total poinnya tercapai). */
  reachedAt: Date;
}

/**
 * Leaderboard: hanya poin > 0, urut poin ↓, jumlah diterima ↓, `reachedAt` ↑ (yang lebih dulu menang), lalu id
 * pengguna agar seri penuh tetap deterministik. Mengembalikan `size` teratas ditambah entri `meId` dengan rank aslinya
 * (`null` bila `meId` tidak punya poin).
 */
export function rankLeaderboard(rows: readonly LeaderboardRow[], meId: string | null, size: number): LeaderboardDto {
  const ranked = rows
    .filter((r) => r.points > 0)
    .toSorted(
      (a, b) =>
        b.points - a.points ||
        b.accepted - a.accepted ||
        a.reachedAt.getTime() - b.reachedAt.getTime() ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    )
    .map(
      (r, i): LeaderboardEntryDto => ({
        rank: i + 1,
        user: { id: r.userId, name: r.name },
        points: r.points,
        accepted: r.accepted,
      }),
    );
  return {
    entries: ranked.slice(0, size),
    me: meId === null ? null : (ranked.find((e) => e.user.id === meId) ?? null),
  };
}
