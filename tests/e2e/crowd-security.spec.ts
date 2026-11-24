import type { Dialog, Locator, Page } from "@playwright/test";
import { crowdReportBody, seedCrowd } from "../support/crowd.js";
import { expect, test } from "../support/fixtures.js";

/** Review Focus 4: Markdown dari crowd yang meniru UI tim atau mencoba menjalankan skrip. */
const PAYLOAD = [
  "## Status: Diterima",
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "[klik](javascript:alert(1))",
  "[data](data:text/html,<script>alert(1)</script>)",
  "![g](https://example.com/a.png)",
  "| Status | Poin |\n|---|---|\n| Diterima | +8 |",
].join("\n\n");
const REPORTER_NAME = "Eve `kode` [tim](https://evil.example.com)";

function recordDialogs(page: Page): Dialog[] {
  const dialogs: Dialog[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog);
    void dialog.dismiss();
  });
  return dialogs;
}

async function expectInert(page: Page, scope: Locator): Promise<void> {
  await expect(scope.getByText("<script>alert(1)</script>").first()).toBeVisible();
  await expect(page.locator("main script, main iframe, main style")).toHaveCount(0);
  await expect(page.locator("main img[src^='http'], main img[src='x']")).toHaveCount(0);
  await expect(page.locator("main a[href^='javascript:'], main a[href^='data:']")).toHaveCount(0);
  await expect(page.locator("main [onerror]")).toHaveCount(0);
}

test.describe("Crowdtesting: keamanan konten laporan", () => {
  test("Markdown berbahaya inert di halaman triase, bug yang dibuat, dan laporan saya; email pelapor tidak bocor", async ({
    api,
    signedInPage,
  }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await api.register({ name: REPORTER_NAME });
    await api.joinCycle(tester, cycle.id);
    const report = await api.submitCrowdReport(
      tester,
      cycle.id,
      crowdReportBody({ title: "Laporan berbahaya", steps: PAYLOAD, expected: PAYLOAD, actual: PAYLOAD, environment: "`env` [x](https://evil.example.com)" }),
    );

    const { page } = await signedInPage(seed.owner);
    const dialogs = recordDialogs(page);
    await page.goto(`/p/${seed.project.slug}/crowd-reports/${report.number}`);
    await expect(page.getByTestId("triage-panel")).toBeVisible();
    await expectInert(page, page.getByTestId("triage-report"));
    // Heading palsu tetap di dalam isi laporan; status asli dari server tidak berubah.
    await expect(page.getByTestId("triage-status")).toHaveText("Dikirim");
    await expect(page.getByTestId("triage-reporter")).toHaveText(REPORTER_NAME);
    await expect(page.locator("body")).not.toContainText(tester.user.email);

    await page.getByTestId("triage-accept").click();
    await page.getByTestId("triage-save").click();
    await page.getByTestId("triage-bug-link").click();
    await expect(page).toHaveURL(/\/bugs\/1$/);
    const description = page.getByTestId("markdown").first();
    await expectInert(page, description);
    // Metadata pelapor ditulis sebagai code span: backtick dan link di nama tidak membentuk link.
    await expect(description.locator("code").filter({ hasText: "tim](https://evil.example.com)" })).toHaveCount(1);
    await expect(page.locator("main a[href^='https://evil.example.com']")).toHaveCount(0);
    await expect(page.getByTestId("bug-crowd-origin")).toContainText(REPORTER_NAME);
    await expect(page.locator("body")).not.toContainText(tester.user.email);

    await page.goto(`/crowd/testers/${tester.user.id}`);
    await expect(page.getByTestId("tester-profile")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(tester.user.email);

    const { page: testerPage } = await signedInPage(tester);
    const testerDialogs = recordDialogs(testerPage);
    await testerPage.goto(`/crowd/r/${report.id}`);
    await expect(testerPage.getByTestId("my-report-status")).toBeVisible();
    await expectInert(testerPage, testerPage.locator("main"));

    expect(dialogs).toHaveLength(0);
    expect(testerDialogs).toHaveLength(0);
  });
});
