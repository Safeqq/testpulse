import { faker } from "@faker-js/faker";
import type { RunDetailDto } from "@testpulse/shared";
import type { BrowserContextOptions } from "@playwright/test";
import { TestApi, type TestUser } from "../support/api-client.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";
import type { RunDates } from "./timestamps.js";

/**
 * Data uji visual regression. Semua yang tampil di layar bernilai tetap (nama, versi, judul bug, pesan error, durasi),
 * sehingga screenshot sama dari run ke run. Hanya yang tidak tampil di halaman yang acak: slug (muncul di URL saja)
 * dan email user. Slug acak membuat seed bisa diulang pada database yang sama tanpa bentrok.
 */

export const SEED_USER_NAME = "Penguji Visual";
export const SEED_TESTER_NAME = "Tester Visual";
export const SEED_PROJECT_NAME = "Aplikasi Demo";

/** Waktu tetap run (ditulis ulang di respons API, lihat timestamps.ts): dua hari berbeda agar grafik tren punya dua titik. */
const RUN_TIMES = { "1.0.0": "2026-01-13T10:00:00.000Z", "1.0.1": "2026-01-14T10:00:00.000Z" } as const;

const COMMIT = "abcdef1234567890abcdef1234567890abcdef12";
const CI_URL = "https://ci.example.com/builds/42";

/** v1.0.0 -> v1.0.1 berpola: 2 regresi, 1 diperbaiki, 1 masih gagal, 1 lebih lambat, 3 baru, 1 hilang. */
const V100: JUnitCase[] = [
  { suite: "checkout", name: "Regresi A", timeSec: 0.4 },
  { suite: "checkout", name: "Regresi B", timeSec: 0.6 },
  { suite: "auth", name: "Diperbaiki C", status: "failed", message: "Dulu gagal", timeSec: 0.3 },
  { suite: "auth", name: "Masih gagal D", status: "failed", message: "Masih rusak", timeSec: 0.5 },
  { suite: "report", name: "Melambat E", timeSec: 1.2 },
  { suite: "report", name: "Stabil F", timeSec: 0.2 },
  { suite: "report", name: "Hilang G", timeSec: 0.2 },
];
const V101: JUnitCase[] = [
  { suite: "checkout", name: "Regresi A", status: "failed", message: "Diharapkan 200 tetapi 500", timeSec: 0.4 },
  { suite: "checkout", name: "Regresi B", status: "failed", message: "Timeout setelah 5 dtk", timeSec: 0.6 },
  { suite: "auth", name: "Diperbaiki C", timeSec: 0.3 },
  { suite: "auth", name: "Masih gagal D", status: "failed", message: "Masih rusak", timeSec: 0.5 },
  { suite: "report", name: "Melambat E", timeSec: 3.4 },
  { suite: "report", name: "Stabil F", timeSec: 0.2 },
  { suite: "report", name: "Baru H", timeSec: 0.2 },
  { suite: "report", name: "Baru I", timeSec: 0.2 },
  { suite: "report", name: "Baru J", timeSec: 0.2 },
];

export interface VisualSeed {
  slug: string;
  /** Bug dengan deskripsi, label, tautan, test asal, komentar, dan riwayat perubahan. */
  detailBugNumber: number;
  /** Id run -> waktu tetap, untuk `freezeApiTimestamps`. */
  runDates: RunDates;
  /** Sesi tester project (bisa menulis bug): pakai sebagai `storageState` context. */
  testerState: NonNullable<BrowserContextOptions["storageState"]>;
}

async function ok(res: { status(): number; text(): Promise<string> }, expected: number, what: string): Promise<void> {
  if (res.status() !== expected) throw new Error(`${what}: diharapkan ${expected}, diterima ${res.status()} ${await res.text()}`);
}

async function publish(api: TestApi, token: string, slug: string, cases: JUnitCase[], version: string): Promise<string> {
  const res = await api.uploadRun(token, slug, buildJUnit(cases), { branch: "main", commit: COMMIT, ciUrl: CI_URL, version });
  await ok(res, 201, `upload ${version}`);
  return ((await res.json()) as { runId: string }).runId;
}

async function testCaseIds(owner: TestUser, slug: string, runId: string): Promise<Record<string, string>> {
  const res = await owner.request.get(`/api/v1/projects/${slug}/runs/${runId}?status=all`);
  await ok(res, 200, "run detail");
  const detail = (await res.json()) as RunDetailDto;
  return Object.fromEntries(detail.results.map((r) => [r.name, r.testCaseId]));
}

/** Membuat user, project publik, dua run berversi, dan tiga bug. Dipanggil sekali per worker. */
export async function seedVisualData(baseURL: string): Promise<VisualSeed> {
  const api = new TestApi(baseURL);
  try {
    const owner = await api.register({ name: SEED_USER_NAME });
    const slug = `visual-${faker.string.alphanumeric({ length: 8, casing: "lower" })}`;
    await api.createProject(owner, { name: SEED_PROJECT_NAME, slug });
    await api.setVisibility(owner, slug, "public");
    const { token } = await api.createToken(owner, slug);

    const run100 = await publish(api, token, slug, V100, "1.0.0");
    const run101 = await publish(api, token, slug, V101, "1.0.1");
    const ids = await testCaseIds(owner, slug, run101);

    // Bug 1: dari test gagal, lengkap; dibuat lalu dikerjakan dan dikomentari supaya linimasa terisi.
    const first = await api.createBug(owner, slug, {
      title: "Checkout mengembalikan 500 setelah kupon dipakai",
      description:
        "## Langkah\n\n1. Tambahkan barang ke keranjang\n2. Pakai kupon `HEMAT10`\n3. Tekan **Bayar**\n\n" +
        "Hasil: halaman galat. Diharapkan: pesanan dibuat.",
      priority: "high",
      severity: "critical",
      assigneeId: owner.user.id,
      labels: ["checkout", "regresi"],
      links: [{ url: "https://ci.example.com/builds/42", title: "Build CI #42" }],
      testCaseId: ids["Regresi A"]!,
      runId: run101,
    });
    await api.updateBug(owner, slug, first.number, { version: first.version, status: "in_progress" });
    await api.addComment(owner, slug, first.number, {
      body: "Sudah direproduksi di lingkungan staging. Penyebabnya perhitungan diskon yang menghasilkan nilai negatif.",
    });

    await api.createBug(owner, slug, {
      title: "Laporan PDF terpotong di halaman kedua",
      description: "Tabel hasil tidak muat dan baris terakhir hilang.",
      priority: "medium",
      severity: "major",
      labels: ["laporan"],
    });

    const third = await api.createBug(owner, slug, {
      title: "Tombol masuk tidak terbaca pada tema gelap",
      priority: "low",
      severity: "minor",
      labels: ["ui"],
    });
    await api.updateBug(owner, slug, third.number, { version: third.version, status: "resolved", resolution: "fixed" });

    // Tester: kontrol tulis (buat bug, ubah, komentar) tampil, berbeda dari pengunjung anonim.
    const tester = await api.register({ name: SEED_TESTER_NAME });
    const invitation = await api.createInvitation(owner, slug, "tester");
    await api.acceptInvitation(tester, invitation.url.slice(invitation.url.lastIndexOf("/") + 1));

    return {
      slug,
      detailBugNumber: first.number,
      runDates: { [run100]: RUN_TIMES["1.0.0"], [run101]: RUN_TIMES["1.0.1"] },
      testerState: await tester.request.storageState(),
    };
  } finally {
    await api.dispose();
  }
}
