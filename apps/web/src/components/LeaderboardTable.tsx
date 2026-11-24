import type { LeaderboardDto, LeaderboardEntryDto } from "@testpulse/shared";
import { Link } from "react-router-dom";
import { testerPath } from "@/lib/crowd";
import { cn } from "@/lib/utils";

function Row({ entry, me, testId }: { entry: LeaderboardEntryDto; me: boolean; testId: string }) {
  return (
    <tr data-testid={testId} className={cn("border-t", me && "bg-accent/60")}>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{entry.rank}</td>
      <th scope="row" className="min-w-0 px-3 py-2 text-left font-medium">
        <Link to={testerPath(entry.user.id)} className="[overflow-wrap:anywhere]">
          {entry.user.name}
        </Link>
        {me ? <span className="ml-2 text-xs font-normal text-muted-foreground">(Anda)</span> : null}
      </th>
      <td className="px-3 py-2 text-right tabular-nums">{entry.points}</td>
      <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{entry.accepted}</td>
    </tr>
  );
}

/**
 * Leaderboard (spec Tahap 5 §6): peringkat, nama tester (tautan profil), poin, dan jumlah laporan diterima. Posisi
 * pengguna yang login ditandai; bila di luar daftar, ditampilkan di baris terpisah di bawahnya.
 */
export function LeaderboardTable({
  data,
  caption,
  limit,
  testId = "leaderboard",
}: {
  data: LeaderboardDto;
  caption: string;
  /** Batasi jumlah baris (mis. cuplikan top 5). */
  limit?: number;
  testId?: string;
}) {
  const entries = limit === undefined ? data.entries : data.entries.slice(0, limit);
  const meShown = data.me !== null && entries.some((e) => e.user.id === data.me!.user.id);
  // Entri global bisa berasal dari cache singkat (spec §6) sementara `me` selalu segar: tetap tampilkan baris saya.
  if (entries.length === 0 && data.me === null) {
    return (
      <p className="m-0 rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
        Belum ada laporan yang diterima. Laporan pertama yang diterima tim akan muncul di sini.
      </p>
    );
  }
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-0 border-collapse text-sm" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="w-12 px-3 py-2 text-right font-medium">
              #
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Tester
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Poin
            </th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
              Diterima
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Row key={entry.user.id} entry={entry} me={entry.user.id === data.me?.user.id} testId={`${testId}-row-${entry.rank}`} />
          ))}
          {data.me !== null && !meShown ? <Row entry={data.me} me testId={`${testId}-me`} /> : null}
        </tbody>
      </table>
    </div>
  );
}
