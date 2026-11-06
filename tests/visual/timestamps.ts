import type { BrowserContext } from "@playwright/test";

/**
 * Jam halaman yang dibekukan. Semua waktu dari API ditulis ulang ke nilai tetap di bawah ini (sebelum jam ini),
 * sehingga tanggal absolut dan waktu relatif ("2 jam lalu") sama dari run ke run dan tidak perlu di-mask.
 */
export const FROZEN_TIME = new Date("2026-01-15T09:00:00Z");

/** Waktu run, per id run: tampil sebagai tanggal absolut (dashboard, grafik tren, pemilih perbandingan). */
export type RunDates = Record<string, string>;

/** Waktu non-run (bug, komentar, aktivitas) per nama field: tampil sebagai waktu relatif ("2 jam lalu"). */
const FIELD_TIMES: Record<string, string> = {
  createdAt: "2026-01-15T07:00:00.000Z",
  updatedAt: "2026-01-15T08:00:00.000Z",
};
const OTHER_TIME = "2026-01-15T08:30:00.000Z";

function isTimestampField(key: string, value: unknown): value is string {
  return key.endsWith("At") && typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * Id run milik objek ini bila objek itu sendiri adalah sebuah run: ringkasan run (`id`) atau titik tren dan hasil riwayat
 * (`runId` bersama `durationMs`). Bug juga punya `runId` (run asalnya), tetapi waktunya waktu bug, bukan waktu run.
 */
function runIdOf(source: Record<string, unknown>, runDates: RunDates): string | undefined {
  const id = source["id"];
  if (typeof id === "string" && id in runDates) return id;
  const runId = source["runId"];
  return typeof runId === "string" && runId in runDates && "durationMs" in source ? runId : undefined;
}

/** Menulis ulang setiap field `*At` bernilai tanggal di JSON `value` (objek di dalamnya ikut), tanpa mengubah yang lain. */
export function normalizeTimestamps(value: unknown, runDates: RunDates): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeTimestamps(item, runDates));
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const runId = runIdOf(source, runDates);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (isTimestampField(key, child)) {
      const runDate = key === "createdAt" && runId !== undefined ? runDates[runId] : undefined;
      result[key] = runDate ?? FIELD_TIMES[key] ?? OTHER_TIME;
    } else {
      result[key] = normalizeTimestamps(child, runDates);
    }
  }
  return result;
}

/** Semua respons JSON `/api/v1/**` di context ini melewati `normalizeTimestamps`. Dipasang sebelum navigasi. */
export async function freezeApiTimestamps(context: BrowserContext, runDates: RunDates): Promise<void> {
  await context.route("**/api/v1/**", async (route) => {
    const response = await route.fetch();
    if (!(response.headers()["content-type"] ?? "").includes("application/json")) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({ response, json: normalizeTimestamps(await response.json(), runDates) });
  });
}
