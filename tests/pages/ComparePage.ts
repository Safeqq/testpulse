import { expect, type Locator, type Page } from "@playwright/test";

export type CompareGroupId = "regressions" | "fixed" | "stillFailing" | "slower" | "added" | "removed";

/** `/p/:slug/compare`: judul, pemilih base/target, kalimat kesimpulan, ringkasan angka, dan kelompok perbandingan. */
export class ComparePage {
  readonly title: Locator;
  readonly base: Locator;
  readonly target: Locator;
  readonly summary: Locator;
  readonly sentence: Locator;
  readonly notFound: Locator;
  readonly sameRun: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByRole("heading", { level: 1 });
    this.base = page.getByTestId("compare-base");
    this.target = page.getByTestId("compare-target");
    this.summary = page.getByTestId("compare-summary");
    this.sentence = page.getByTestId("compare-sentence");
    this.notFound = page.getByTestId("compare-not-found");
    this.sameRun = page.getByTestId("compare-same-run");
  }

  group(id: CompareGroupId): Locator {
    return this.page.getByTestId(`compare-group-${id}`);
  }

  /** Angka ringkasan (tautan ke kelompoknya). */
  count(id: CompareGroupId): Locator {
    return this.page.getByTestId(`compare-count-${id}`);
  }

  more(id: CompareGroupId): Locator {
    return this.page.getByTestId(`compare-more-${id}`);
  }

  row(testCaseId: string): Locator {
    return this.page.getByTestId(`compare-row-${testCaseId}`);
  }

  rows(id: CompareGroupId): Locator {
    return this.group(id).locator('[data-testid^="compare-row-"]');
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
    await expect(this.summary.or(this.notFound).or(this.sameRun).or(this.page.getByTestId("project-not-found"))).toBeVisible();
  }
}
