import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug`: ringkasan project (dashboard hasil test, panduan setup, atau keadaan kosong untuk pengunjung). */
export class ProjectPage {
  readonly title: Locator;
  readonly publicBadge: Locator;
  readonly notFound: Locator;
  readonly emptyResults: Locator;
  readonly setupInstructions: Locator;
  readonly settingsLink: Locator;
  readonly loginButton: Locator;
  readonly dashboardBranch: Locator;
  readonly statLastStatus: Locator;
  readonly statPassRate: Locator;
  readonly statTotal: Locator;
  readonly statFlaky: Locator;
  readonly trendChart: Locator;
  readonly trendPoints: Locator;
  readonly recentRuns: Locator;
  readonly runItems: Locator;
  readonly topFlaky: Locator;
  readonly flakyItems: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId("project-title");
    this.publicBadge = page.getByTestId("public-badge");
    this.notFound = page.getByTestId("project-not-found");
    this.emptyResults = page.getByTestId("empty-results");
    this.setupInstructions = page.getByTestId("setup-instructions");
    this.settingsLink = page.getByTestId("settings-link");
    this.loginButton = page.getByTestId("project-login");
    this.dashboardBranch = page.getByTestId("dashboard-branch");
    this.statLastStatus = page.getByTestId("stat-last-status");
    this.statPassRate = page.getByTestId("stat-pass-rate");
    this.statTotal = page.getByTestId("stat-total");
    this.statFlaky = page.getByTestId("stat-flaky");
    this.trendChart = page.getByTestId("trend-chart");
    this.trendPoints = this.trendChart.locator("circle");
    this.recentRuns = page.getByTestId("recent-runs");
    this.runItems = this.recentRuns.locator('[data-testid^="run-item-"]');
    this.topFlaky = page.getByTestId("top-flaky");
    this.flakyItems = this.topFlaky.locator('[data-testid^="flaky-item-"]');
  }

  async goto(slug: string): Promise<void> {
    await this.page.goto(`/p/${slug}`);
    await expect(this.title.or(this.notFound)).toBeVisible();
  }

  /** Menunggu dashboard (bukan hanya judul project) selesai dimuat; kerangka lazy-load tidak punya `dashboard-branch`. */
  async expectDashboard(): Promise<void> {
    await expect(this.dashboardBranch).toBeVisible();
    await expect(this.statLastStatus).toBeVisible();
  }
}
