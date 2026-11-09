import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/versions`: tabel versi di satu branch dengan pass rate, perubahan, dan tautan bandingkan. */
export class VersionsPage {
  readonly title: Locator;
  readonly branchFilter: Locator;
  readonly table: Locator;
  readonly empty: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByRole("heading", { level: 1, name: "Versi" });
    this.branchFilter = page.getByTestId("versions-branch");
    this.table = page.getByTestId("versions-table");
    this.empty = page.getByTestId("versions-empty");
  }

  row(version: string): Locator {
    return this.page.getByTestId(`version-row-${version}`);
  }

  /** Sel kolom Manual (layar lebar). */
  manual(version: string): Locator {
    return this.page.getByTestId(`version-manual-${version}`);
  }

  /** Ringkasan Manual di bawah versi (layar sempit, saat kolomnya disembunyikan). */
  manualCompact(version: string): Locator {
    return this.page.getByTestId(`version-manual-compact-${version}`);
  }

  compareLink(version: string): Locator {
    return this.page.getByTestId(`version-compare-${version}`);
  }

  async goto(slug: string, branch?: string): Promise<void> {
    await this.page.goto(branch ? `/p/${slug}/versions?branch=${encodeURIComponent(branch)}` : `/p/${slug}/versions`);
    await expect(this.table.or(this.empty)).toBeVisible();
  }
}
