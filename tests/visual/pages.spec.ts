import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "../support/fixtures.js";
import { seedVisualData, type VisualSeed } from "./seed.js";
import { FROZEN_TIME, freezeApiTimestamps } from "./timestamps.js";

const THEMES = ["light", "dark"] as const;
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
} as const;

/**
 * Toleransi per screenshot. Diukur: 5 run berturut-turut pada stack baru (docker compose down -v) menghasilkan selisih
 * 0 piksel di semua screenshot (76 pada Tahap 3), jadi batas di bawah hanya cadangan untuk beda sub-piksel antar mesin (mis. runner CI),
 * bukan untuk menyerap noise. Batas 1% di config hanya jaring pengaman: sendirian ia meloloskan perubahan kecil
 * (satu tombol, satu warna). `threshold` 0.1 menoleransi anti-aliasing, bukan perubahan warna.
 */
const FULL_PAGE = { maxDiffPixels: 50, threshold: 0.1 } as const;
const ELEMENT = { maxDiffPixels: 10, threshold: 0.1 } as const;

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

interface ElementShot {
  name: string;
  locator: (page: Page) => Locator;
}

interface PageCase {
  name: string;
  /** `tester`: context masuk sebagai tester project, sehingga kontrol tulis tampil. */
  viewer: "anonymous" | "tester";
  path: (seed: VisualSeed) => string;
  /** Slug project tempat halaman ini hidup (project utama bila tidak diisi). */
  slug?: (seed: VisualSeed) => string;
  /** Elemen yang menandai halaman sudah menampilkan data sungguhan (bukan kerangka atau status memuat). */
  ready: (page: Page) => Locator;
  /** Halaman berisi slug acak dari seed yang perlu di-mask; landing statis tidak. */
  hasSlug: boolean;
  /** Bagian halaman yang juga diambil sendiri dengan toleransi lebih ketat. */
  elements: ElementShot[];
}

const bugRow = (n: number): ElementShot => ({ name: `row-${n}`, locator: (page) => page.getByTestId(`bug-row-${n}`) });
const bugDetailElements: ElementShot[] = [
  { name: "status", locator: (page) => page.getByTestId("bug-status") },
  { name: "sidebar", locator: (page) => page.locator("aside") },
];

const PAGES: PageCase[] = [
  { name: "landing", viewer: "anonymous", path: () => "/", ready: (page) => page.getByTestId("landing-roadmap"), hasSlug: false, elements: [] },
  {
    name: "dashboard",
    viewer: "anonymous",
    path: (s) => `/p/${s.slug}`,
    ready: (page) => page.getByTestId("version-card").getByTestId("compare-sentence"),
    hasSlug: true,
    elements: [
      { name: "header", locator: (page) => page.getByRole("banner") },
      { name: "tabs", locator: (page) => page.getByTestId("project-tabs") },
      { name: "stat-cards", locator: (page) => page.getByTestId("stat-last-status").locator("..") },
      { name: "version-card", locator: (page) => page.getByTestId("version-card") },
    ],
  },
  {
    name: "compare",
    viewer: "anonymous",
    path: (s) => `/p/${s.slug}/compare`,
    ready: (page) => page.getByTestId("compare-sentence"),
    hasSlug: true,
    elements: [{ name: "summary", locator: (page) => page.getByTestId("compare-summary") }],
  },
  {
    name: "bugs",
    viewer: "anonymous",
    path: (s) => `/p/${s.slug}/bugs?status=all`,
    ready: (page) => page.getByRole("link", { name: /Laporan PDF terpotong/ }),
    hasSlug: true,
    elements: [bugRow(3), bugRow(2)],
  },
  {
    name: "bug-detail",
    viewer: "anonymous",
    path: (s) => `/p/${s.slug}/bugs/${s.detailBugNumber}`,
    ready: (page) => page.getByTestId("bug-activity"),
    hasSlug: true,
    elements: bugDetailElements,
  },
  {
    name: "bugs-tester",
    viewer: "tester",
    path: (s) => `/p/${s.slug}/bugs?status=all`,
    ready: (page) => page.getByTestId("bug-create"),
    hasSlug: true,
    elements: [bugRow(3)],
  },
  {
    name: "bug-detail-tester",
    viewer: "tester",
    path: (s) => `/p/${s.slug}/bugs/${s.detailBugNumber}`,
    ready: (page) => page.getByTestId("bug-activity"),
    hasSlug: true,
    elements: bugDetailElements,
  },
  {
    name: "manual-cases",
    viewer: "anonymous",
    path: (s) => `/p/${s.manual.slug}/cases`,
    slug: (s) => s.manual.slug,
    ready: (page) => page.getByTestId("case-row-4"),
    hasSlug: true,
    elements: [{ name: "row-4", locator: (page) => page.getByTestId("case-row-4") }],
  },
  {
    name: "manual-run",
    viewer: "tester",
    path: (s) => `/p/${s.manual.slug}/manual-runs/${s.manual.runNumber}`,
    slug: (s) => s.manual.slug,
    ready: (page) => page.getByTestId("run-case-list"),
    hasSlug: true,
    elements: [{ name: "header", locator: (page) => page.getByTestId("run-header") }],
  },
  {
    name: "manual-execute",
    viewer: "tester",
    path: (s) => `/p/${s.manual.slug}/manual-runs/${s.manual.runNumber}/cases/${s.manual.partialRunCaseId}`,
    slug: (s) => s.manual.slug,
    ready: (page) => page.getByTestId("exec-use-suggestion"),
    hasSlug: true,
    elements: [{ name: "suggestion", locator: (page) => page.getByTestId("exec-suggestion") }],
  },
];

/** Satu-satunya yang tetap di-mask: slug project acak per seed, tampil sebagai "/p/<slug>" di bawah judul project. */
function slugMask(page: Page, slug: string): Locator[] {
  return [page.getByText(`/p/${slug}`, { exact: true })];
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
          ...(pageCase.viewer === "tester" ? { storageState: seed.testerState } : {}),
        });
        // Jam dan waktu dari API dibekukan sebelum halaman dibuat agar tak ada yang berubah antar-run.
        await context.clock.install({ time: FROZEN_TIME });
        await freezeApiTimestamps(context, seed.runDates);
        const page = await context.newPage();

        await page.goto(pageCase.path(seed));
        await expect(pageCase.ready(page)).toBeVisible();
        await expect(page.locator("html")).toHaveClass(theme === "dark" ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b)/);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);

        // Soft: satu run melaporkan semua screenshot yang berubah (artifact berisi semua diff), bukan hanya yang pertama.
        const suffix = `${theme}-${viewportName}.png`;
        await expect.soft(page).toHaveScreenshot(`${pageCase.name}-${suffix}`, {
          fullPage: true,
          mask: pageCase.hasSlug ? slugMask(page, pageCase.slug?.(seed) ?? seed.slug) : [],
          animations: "disabled",
          ...FULL_PAGE,
        });
        for (const element of pageCase.elements) {
          await expect.soft(element.locator(page)).toHaveScreenshot(`${pageCase.name}-${element.name}-${suffix}`, {
            animations: "disabled",
            ...ELEMENT,
          });
        }
      });
    }
  }
}
