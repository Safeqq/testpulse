import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { test } from "../support/fixtures.js";
import { attachCspGuard } from "../support/csp.js";

// Spec ini menguji gate CSP itu sendiri, jadi memakai `browser` mentah + `attachCspGuard` (bukan context fixture
// yang otomatis menggagalkan test). CSP disajikan lewat `page.route`, sehingga tidak bergantung pada nginx.
const CSP = "style-src 'self'";

async function serve(page: Page, path: string, body: string, csp: string | null): Promise<void> {
  await page.route(`**${path}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: csp ? { "Content-Security-Policy": csp } : {},
      body,
    }),
  );
}

base.describe("gate CSP", () => {
  let context: BrowserContext;

  base.beforeEach(async ({ browser: rawBrowser, baseURL }) => {
    context = await rawBrowser.newContext({ baseURL });
  });

  base.afterEach(async () => {
    await context.close();
  });

  base("style inline yang diblokir CSP tercatat sebagai pelanggaran style-src", async () => {
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><div style="color:red">merah</div>`, CSP);

    await page.goto("/__csp-probe");

    await expect.poll(() => guard.violations().length).toBeGreaterThanOrEqual(1);
    const [first] = guard.violations();
    expect(first?.directive.startsWith("style-src")).toBe(true);
    expect(first?.url).toContain("/__csp-probe");
  });

  base("halaman tanpa pelanggaran tidak mencatat apa pun", async () => {
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><p>bersih</p>`, CSP);

    await page.goto("/__csp-probe");
    await expect(page.getByText("bersih")).toBeVisible();

    expect(guard.violations()).toEqual([]);
  });

  base("<select> yang dibuat lewat script tidak dihitung (artefak WebKit), atribut style asli pada select tetap dihitung", async () => {
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><div id="host"></div>`, CSP);
    await page.goto("/__csp-probe");

    await page.evaluate(() => {
      document.getElementById("host")?.appendChild(document.createElement("select"));
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(guard.violations()).toEqual([]);

    await page.evaluate(() => {
      const select = document.createElement("select");
      select.setAttribute("style", "color:red");
      document.getElementById("host")?.appendChild(select);
    });
    await expect.poll(() => guard.violations().length).toBeGreaterThanOrEqual(1);
  });

  base("pelanggaran di dalam iframe juga tercatat", async () => {
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><iframe src="/__csp-probe-frame"></iframe>`, null);
    await serve(page, "/__csp-probe-frame", `<!doctype html><div style="color:red">di frame</div>`, CSP);

    await page.goto("/__csp-probe");

    await expect.poll(() => guard.violations().length).toBeGreaterThanOrEqual(1);
    expect(guard.violations()[0]?.url).toContain("/__csp-probe-frame");
  });
});

test.describe("fixture test menggagalkan test yang melanggar CSP", () => {
  // Test ini sengaja gagal di teardown (gate CSP); `test.fail()` membalik hasilnya sehingga lulus bila gate bekerja.
  test.fail();

  test("page dari fixture dengan pelanggaran CSP membuat test gagal", async ({ page }) => {
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><div style="color:red">merah</div>`, CSP);
    await page.goto("/__csp-probe");
    await expect(page.getByText("merah")).toBeVisible();
    // Beri waktu event securitypolicyviolation sampai ke binding sebelum teardown.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
  });
});
