import { expect, type Locator, type Page } from "@playwright/test";

export type QualityLink = "allure" | "ci" | "source" | "strategy";
export type FeatureSlug =
  | "projects"
  | "team"
  | "invitations"
  | "dashboard"
  | "bug-tracker"
  | "manual-tests"
  | "crowdtesting";

/** Landing page `/` untuk pengunjung anonim. */
export class LandingPage {
  readonly hero: Locator;
  readonly ctaRegister: Locator;
  readonly ctaDemo: Locator;
  readonly features: Locator;
  readonly soonBadges: Locator;
  readonly howItWorks: Locator;
  readonly quality: Locator;
  readonly roadmap: Locator;
  readonly footer: Locator;
  /** Kerangka netral saat status auth masih `loading`. */
  readonly loading: Locator;

  constructor(private readonly page: Page) {
    this.hero = page.getByTestId("landing-hero");
    this.ctaRegister = page.getByTestId("landing-cta-register");
    this.ctaDemo = page.getByTestId("landing-cta-demo");
    this.features = page.getByTestId("landing-features");
    this.soonBadges = page.getByTestId("feature-soon-badge");
    this.howItWorks = page.getByTestId("landing-how-it-works");
    this.quality = page.getByTestId("landing-quality");
    this.roadmap = page.getByTestId("landing-roadmap");
    this.footer = page.getByTestId("landing-footer");
    this.loading = page.getByTestId("home-loading");
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
    await expect(this.hero).toBeVisible();
  }

  feature(slug: FeatureSlug): Locator {
    return this.page.getByTestId(`feature-${slug}`);
  }

  qualityLink(name: QualityLink): Locator {
    return this.page.getByTestId(`quality-link-${name}`);
  }
}
