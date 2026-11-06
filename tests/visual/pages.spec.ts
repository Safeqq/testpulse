import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "../support/fixtures.js";
import { seedVisualData, type VisualSeed } from "./seed.js";

/** Jam yang dibekukan sebelum navigasi: lebih lama dari data apa pun, sehingga waktu relatif selalu "baru saja". */
const FROZEN_TIME = new Date("2026-01-15T09:00:00Z");

const THEMES = ["light", "dark"] as const;
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
} as const;

interface WorkerFixtures {
  seed: VisualSeed;
}

const test = base.extend<object, WorkerFixtures>({
  // Satu seed per worker: nilainya tetap, jadi seed ganda tidak mengubah tampilan.
  seed: [
    async ({}, use) => {
      await use(await seedVisualData(process.env.BASE_URL ?? "http://localhost:5173"));
    },
    { scope: "worker" },
  ],
});

/** Teks tanggal/jam absolut hasil `formatDateTime` ("15 Jan 2026 09.00") dan `formatShortDate` ("15 Jan"). */
const ABSOLUTE_DATE = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)(?:\w*)?(?: \d{4})?\b/;
/** Id run delapan heksadesimal ("run #1a2b3c4d") yang dibuat server. */
const RUN_ID = /run #[0-9a-f]{8}/;

interface PageCase {
  name: string;
  path: (seed: VisualSeed) => string;
  /** Elemen yang menandai halaman sudah menampilkan data sungguhan (bukan kerangka atau status memuat). */
  ready: (page: Page) => Locator;
  /** Halaman berisi data dari seed (waktu, id, slug) yang perlu di-mask; landing statis tidak. */
  dynamic: boolean;
}

const PAGES: PageCase[] = [
  { name: "landing", path: () => "/", ready: (page) => page.getByTestId("landing-roadmap"), dynamic: false },
  { name: "dashboard", path: (s) => `/p/${s.slug}`, ready: (page) => page.getByTestId("version-card").getByTestId("compare-sentence"), dynamic: true },
  { name: "compare", path: (s) => `/p/${s.slug}/compare`, ready: (page) => page.getByTestId("compare-sentence"), dynamic: true },
  { name: "bugs", path: (s) => `/p/${s.slug}/bugs?status=all`, ready: (page) => page.getByRole("link", { name: /Laporan PDF terpotong/ }), dynamic: true },
  { name: "bug-detail", path: (s) => `/p/${s.slug}/bugs/${s.detailBugNumber}`, ready: (page) => page.getByTestId("bug-activity"), dynamic: true },
];

/** Hanya elemen yang tampil: teks khusus pembaca layar (.sr-only) dan <title> SVG tidak punya kotak yang layak ditutup. */
const RENDERED = ":not(.sr-only, .sr-only *, title)";

/** Bagian yang nilainya berubah tiap run (waktu, id, slug) ditutup dengan mask. */
function dynamicMasks(page: Page, seed: VisualSeed): Locator[] {
  const rendered = page.locator(RENDERED);
  return [
    page.locator("time"),
    page.getByText(ABSOLUTE_DATE).and(rendered),
    page.getByText(RUN_ID).and(rendered),
    // Slug acak per seed: tampil sebagai "/p/<slug>" di bawah judul project.
    page.getByText(`/p/${seed.slug}`, { exact: true }),
    // Teks <option> terpilih memuat tanggal run dan tidak bisa ditutup sebagian.
    page.getByTestId("compare-base"),
    page.getByTestId("compare-target"),
  ];
}

for (const pageCase of PAGES) {
  for (const theme of THEMES) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      test(`${pageCase.name} - ${theme} - ${viewportName}`, async ({ newContext, seed }) => {
        const context = await newContext({
          viewport,
          colorScheme: theme,
          locale: "id-ID",
          timezoneId: "UTC",
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        // Dibekukan sebelum halaman dibuat agar Date.now() sudah palsu sejak skrip pertama.
        await context.clock.install({ time: FROZEN_TIME });
        const page = await context.newPage();

        await page.goto(pageCase.path(seed));
        await expect(pageCase.ready(page)).toBeVisible();
        await expect(page.locator("html")).toHaveClass(theme === "dark" ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);

        await expect(page).toHaveScreenshot(`${pageCase.name}-${theme}-${viewportName}.png`, {
          fullPage: true,
          mask: pageCase.dynamic ? dynamicMasks(page, seed) : [],
          animations: "disabled",
        });
      });
    }
  }
}
