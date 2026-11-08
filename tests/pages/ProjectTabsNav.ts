import type { Locator, Page } from "@playwright/test";

export type TabId = "ringkasan" | "run" | "versi" | "manual" | "bug" | "flaky" | "pengaturan";

/** Tab navigasi project (muncul di ringkasan dan halaman hasil test): Ringkasan · Run · Versi · Test manual · Bug · Flaky · Pengaturan. */
export class ProjectTabsNav {
  readonly root: Locator;
  readonly tabs: Locator;
  readonly current: Locator;

  constructor(page: Page) {
    this.root = page.getByTestId("project-tabs");
    this.tabs = this.root.getByRole("link");
    this.current = this.root.locator('[aria-current="page"]');
  }

  tab(id: TabId): Locator {
    return this.root.getByTestId(`tab-${id}`);
  }

  /** Lebar konten tab dikurangi lebar wadah: > 0 berarti tab bisa digeser di dalam wadahnya. */
  async scrollOverflow(): Promise<number> {
    return this.root.locator("ul").evaluate((el) => el.scrollWidth - el.clientWidth);
  }
}
