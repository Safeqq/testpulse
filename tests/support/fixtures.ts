import { test as base, expect, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./a11y.js";
import { TestApi, type TestUser } from "./api-client.js";

export interface SignedIn {
  page: Page;
  user: TestUser;
}

interface Fixtures {
  api: TestApi;
  /** Mendaftarkan user lewat API (atau memakai `user`), lalu membuka page di context baru yang sudah masuk. */
  signedInPage: (user?: TestUser) => Promise<SignedIn>;
  expectNoA11yViolations: (page: Page) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  api: async ({ baseURL }, use) => {
    const api = new TestApi(baseURL ?? "http://localhost:5173");
    await use(api);
    await api.dispose();
  },

  signedInPage: async ({ browser, baseURL, api }, use) => {
    const contexts: Array<{ close(): Promise<void> }> = [];
    await use(async (existing) => {
      const user = existing ?? (await api.register());
      const storageState = await user.request.storageState();
      const context = await browser.newContext({ baseURL, storageState });
      contexts.push(context);
      return { page: await context.newPage(), user };
    });
    await Promise.all(contexts.map((c) => c.close()));
  },

  expectNoA11yViolations: async ({}, use) => {
    await use(expectNoA11yViolations);
  },
});

export { expect };
