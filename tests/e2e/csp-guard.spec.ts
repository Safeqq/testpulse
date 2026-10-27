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
  let opened: BrowserContext | undefined;

  function ctx(): BrowserContext {
    if (!opened) throw new Error("context belum dibuat");
    return opened;
  }

  base.beforeEach(async ({ browser: rawBrowser, baseURL }) => {
    opened = await rawBrowser.newContext({ baseURL });
  });

  base.afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });

  base("style inline yang diblokir CSP tercatat sebagai pelanggaran style-src", async () => {
    const context = ctx();
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
    const context = ctx();
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><p>bersih</p>`, CSP);

    await page.goto("/__csp-probe");
    await expect(page.getByText("bersih")).toBeVisible();

    expect(guard.violations()).toEqual([]);
  });

  base("<select> yang dibuat lewat script tidak dihitung (artefak WebKit), atribut style asli pada select tetap dihitung", async () => {
    const context = ctx();
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

  const CONSOLE_SAMPLES = [
    {
      engine: "Chromium",
      text: "Refused to load the image 'http://blocked.example/a.png' because it violates the following Content Security Policy directive: \"img-src 'self'\".",
      directive: "img-src",
    },
    {
      engine: "Firefox",
      text: "Content-Security-Policy: The page’s settings blocked the loading of a resource (img-src) at http://blocked.example/a.png because it violates the following directive: “img-src 'self'”",
      directive: "img-src",
    },
    {
      engine: "WebKit",
      text: "Refused to load http://blocked.example/x.js because it does not appear in the script-src directive of the Content Security Policy.",
      directive: "script-src",
    },
  ];

  for (const sample of CONSOLE_SAMPLES) {
    base(`pelanggaran yang hanya muncul di console terdeteksi (format ${sample.engine})`, async () => {
      const context = ctx();
      const guard = await attachCspGuard(context);
      const page = await context.newPage();
      await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><p>bersih</p>`, null);
      await page.goto("/__csp-probe");

      await page.evaluate((text) => console.error(text), sample.text);

      await expect.poll(() => guard.violations().length).toBe(1);
      const [violation] = guard.violations();
      expect(violation?.directive).toBe(sample.directive);
      expect(violation?.blockedURI).toBe("http://blocked.example/" + (sample.directive === "img-src" ? "a.png" : "x.js"));
      expect(violation?.url).toContain("/__csp-probe");
    });
  }

  base("console error biasa yang tidak menyebut CSP diabaikan", async () => {
    const context = ctx();
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><p>bersih</p>`, null);
    await page.goto("/__csp-probe");

    await page.evaluate(() => console.error("Failed to fetch /api/x"));
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));

    expect(guard.violations()).toEqual([]);
  });

  base("pelanggaran yang dilaporkan event dan console dihitung sekali (eval yang ditangkap)", async () => {
    const context = ctx();
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(
      page,
      "/__csp-probe",
      `<!doctype html><title>probe</title><script>try { eval("1") } catch (e) {}</script>`,
      "script-src 'self' 'unsafe-inline'",
    );

    await page.goto("/__csp-probe");

    await expect.poll(() => guard.violations().length).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(guard.violations().map((v) => v.directive)).toEqual(["script-src"]);
  });

  base("pelanggaran CSP di dalam worker terdeteksi (hanya WebKit menampilkannya di console)", async ({ browserName }) => {
    base.skip(browserName !== "webkit", "Chromium dan Firefox tidak menampilkan pesan CSP worker lewat console Playwright");
    const context = ctx();
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><p>bersih</p>`, null);
    await page.route("**/__csp-worker.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        headers: { "Content-Security-Policy": "connect-src 'self'" },
        body: "fetch(\"http://blocked.example/\").catch(() => undefined);",
      }),
    );
    await page.goto("/__csp-probe");

    await page.evaluate(() => {
      new Worker("/__csp-worker.js");
    });

    await expect.poll(() => guard.violations().length).toBeGreaterThanOrEqual(1);
    expect(guard.violations()[0]?.directive).toBe("connect-src");
  });

  base("guard gagal tertutup bila binding tidak tersedia di suatu dokumen", async () => {
    const context = ctx();
    // Mensimulasikan binding yang hilang: properti dikunci undefined sebelum exposeBinding sempat memasangnya.
    await context.addInitScript(() => {
      Object.defineProperty(window, "__tpReportCsp", { value: undefined, writable: false, configurable: false });
    });
    const guard = await attachCspGuard(context);
    const page = await context.newPage();
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><p>bersih</p>`, null);

    await page.goto("/__csp-probe");

    await expect.poll(() => guard.violations().some((v) => v.directive === "tp-guard-missing")).toBe(true);
  });

  base("pelanggaran di dalam iframe juga tercatat", async () => {
    const context = ctx();
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
  test("page dari fixture memasang guard dan pelanggaran tercatat", async ({ page, cspGuards }) => {
    await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><div style="color:red">merah</div>`, CSP);
    await page.goto("/__csp-probe");
    await expect(page.getByText("merah")).toBeVisible();

    await expect.poll(() => cspGuards.flatMap((g) => g.violations()).length).toBeGreaterThanOrEqual(1);
    expect(cspGuards.flatMap((g) => g.violations())[0]?.directive.startsWith("style-src")).toBe(true);

    // Sengaja dikosongkan agar teardown fixture tidak menggagalkan test ini; teardown diuji di test berikutnya.
    cspGuards.length = 0;
  });

  test.describe("teardown", () => {
    test.fail(true, "Pelanggaran CSP sengaja dibiarkan; test lulus hanya bila teardown fixture menggagalkannya");

    test("pelanggaran yang dibiarkan menggagalkan test di teardown", async ({ page }) => {
      await serve(page, "/__csp-probe", `<!doctype html><title>probe</title><div style="color:red">merah</div>`, CSP);
      await page.goto("/__csp-probe");
      await expect(page.getByText("merah")).toBeVisible();
      // Beri waktu event securitypolicyviolation sampai ke binding sebelum teardown.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
    });
  });
});

// Kanari header CSP: hanya bermakna terhadap stack yang disajikan nginx/Cloudflare (BASE_URL terisi). Dev server Vite
// tidak mengirim CSP, jadi tanpa BASE_URL test ini dilewati. Tanpa header ini seluruh gate "0 pelanggaran" tak berarti.
test.describe("kanari header CSP pada dokumen yang disajikan", () => {
  test.skip(!process.env.BASE_URL, "BASE_URL tidak diisi: dev server tidak mengirim CSP");

  for (const path of ["/", "/login"]) {
    test(`respons dokumen ${path} membawa CSP dengan style-src 'self' dan script-src 'self'`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const csp = response.headers()["content-security-policy"];
      expect(csp, "header content-security-policy").toBeTruthy();
      const directives = (csp ?? "").split(";").map((d) => d.trim());
      expect(directives).toContain("style-src 'self'");
      expect(directives).toContain("script-src 'self'");
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    });
  }
});
