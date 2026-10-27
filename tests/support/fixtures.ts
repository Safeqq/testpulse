import { test as base, expect, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoA11yViolationsInBothThemes } from "./a11y.js";
import { TestApi, type TestUser } from "./api-client.js";
import { attachCspGuard, describeViolation, type CspGuard } from "./csp.js";

export interface SignedIn {
  page: Page;
  user: TestUser;
}

interface Fixtures {
  api: TestApi;
  /** Mendaftarkan user lewat API (atau memakai `user`), lalu membuka page di context baru yang sudah masuk. */
  signedInPage: (user?: TestUser) => Promise<SignedIn>;
  /** Context baru (baseURL dari config, guard CSP terpasang, ditutup otomatis di akhir test). */
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  expectNoA11yViolations: (page: Page) => Promise<void>;
  /** Seperti `expectNoA11yViolations`, tetapi di tema terang lalu gelap (berakhir di terang). */
  expectNoA11yViolationsInBothThemes: (page: Page) => Promise<void>;
}

interface InternalFixtures {
  /** Guard dari semua context yang dibuat test ini; pelanggarannya dipastikan kosong di teardown. */
  cspGuards: CspGuard[];
}

export const test = base.extend<Fixtures & InternalFixtures>({
  api: async ({ baseURL }, use) => {
    const api = new TestApi(baseURL ?? "http://localhost:5173");
    await use(api);
    await api.dispose();
  },

  // Fixture ini di-teardown setelah semua fixture yang bergantung padanya (context ditutup lebih dulu).
  cspGuards: async ({}, use) => {
    const guards: CspGuard[] = [];
    await use(guards);
    const violations = guards.flatMap((g) => g.violations()).map(describeViolation);
    expect(violations, "pelanggaran CSP").toEqual([]);
  },

  // Context bawaan Playwright (dipakai fixture `page`) diberi guard.
  context: async ({ context, cspGuards }, use) => {
    cspGuards.push(await attachCspGuard(context));
    await use(context);
  },

  newContext: async ({ browser, baseURL, cspGuards }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options) => {
      const context = await browser.newContext({ baseURL, ...options });
      contexts.push(context);
      cspGuards.push(await attachCspGuard(context));
      return context;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },

  signedInPage: async ({ newContext, api }, use) => {
    await use(async (existing) => {
      const user = existing ?? (await api.register());
      const storageState = await user.request.storageState();
      const context = await newContext({ storageState });
      return { page: await context.newPage(), user };
    });
  },

  expectNoA11yViolations: async ({}, use) => {
    await use(expectNoA11yViolations);
  },

  expectNoA11yViolationsInBothThemes: async ({}, use) => {
    await use(expectNoA11yViolationsInBothThemes);
  },
});

export { expect };
