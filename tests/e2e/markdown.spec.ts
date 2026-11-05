import type { Dialog, Page } from "@playwright/test";
import { BugPage } from "../pages/BugPage.js";
import { expect, test } from "../support/fixtures.js";

/** Muatan berbahaya spec Tahap 3 §3.5: skrip, atribut event, link javascript:, dan gambar eksternal. */
const DANGEROUS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "[klik](javascript:alert(1))",
  "![g](https://example.com/a.png)",
];
const FOOTNOTE = ["Catatan[^1] dan [aman](https://example.com/aman)", "[^1]: isi catatan"].join("\n\n");

/** Satu blok per elemen: HTML mentah, link berbahaya, dan gambar masing-masing diproses sendiri oleh Markdown. */
const PAYLOAD = [...DANGEROUS, FOOTNOTE].join("\n\n");
/** Tanpa baris kosong: blok HTML `<img ...>` menelan baris berikutnya, jadi semuanya menjadi teks. */
const COMPACT = DANGEROUS.join("\n");

/** Mencatat dialog (alert/confirm/prompt) yang muncul; semuanya langsung ditutup agar halaman tidak menggantung. */
function recordDialogs(page: Page): Dialog[] {
  const dialogs: Dialog[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog);
    void dialog.dismiss();
  });
  return dialogs;
}

test.describe("Markdown aman di detail bug", () => {
  test("deskripsi dan komentar berbahaya tampil inert untuk pemilik, viewer, dan anonim", async ({
    api,
    signedInPage,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await api.setVisibility(owner, project.slug, "public");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    await api.createBug(owner, project.slug, { title: "Bug Markdown berbahaya", description: PAYLOAD });
    await api.addComment(owner, project.slug, 1, { body: PAYLOAD });
    await api.addComment(owner, project.slug, 1, { body: COMPACT });

    const { page: ownerPage } = await signedInPage(owner);
    const { page: viewerPage } = await signedInPage(viewer);
    const anonymousPage = await (await newContext()).newPage();

    for (const page of [ownerPage, viewerPage, anonymousPage]) {
      const dialogs = recordDialogs(page);
      const bug = new BugPage(page);
      await bug.goto(project.slug, 1);
      await expect(bug.comments).toHaveCount(2);
      const blocks = page.getByTestId("markdown");
      await expect(blocks).toHaveCount(3);

      for (const block of await blocks.all()) {
        // HTML mentah tampil sebagai teks, bukan elemen; tidak ada href berbahaya di mana pun.
        await expect(block).toContainText("<script>alert(1)</script>");
        await expect(block).toContainText("<img src=x onerror=alert(1)>");
        await expect(block.locator("script, img, iframe, style")).toHaveCount(0);
        await expect(block.locator('a[href^="javascript" i]')).toHaveCount(0);
        await expect(block.getByRole("link", { name: "klik" })).toHaveCount(0);
        await expect(block.locator("[id]")).toHaveCount(0);
      }

      // Deskripsi dan komentar pertama: setiap elemen berbahaya diproses sendiri.
      for (const block of [blocks.nth(0), blocks.nth(1)]) {
        await expect(block).toContainText("klik");
        const image = block.getByRole("link", { name: "g", exact: true });
        await expect(image).toHaveAttribute("href", "https://example.com/a.png");
        await expect(image).toHaveAttribute("target", "_blank");
        await expect(image).toHaveAttribute("rel", "noopener noreferrer");
        const safe = block.getByRole("link", { name: "aman" });
        await expect(safe).toHaveAttribute("rel", "noopener noreferrer");
        // Catatan kaki tidak didukung: tetap teks, tanpa id bawaan.
        await expect(block).toContainText("[^1]");
        await expect(block).toContainText("isi catatan");
      }

      expect(await page.locator("img").count(), "tidak ada <img> di halaman").toBe(0);
      const duplicateIds = await page.evaluate(() => {
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const element of document.querySelectorAll("[id]")) {
          if (seen.has(element.id)) duplicates.push(element.id);
          seen.add(element.id);
        }
        return duplicates;
      });
      expect(duplicateIds).toEqual([]);

      // Beri waktu bila ada skrip yang terlambat jalan; tidak boleh ada dialog.
      await page.waitForTimeout(300);
      expect(dialogs.map((dialog) => dialog.message())).toEqual([]);
      await expectNoA11yViolationsInBothThemes(page);
    }
  });

  test("pratinjau komentar dan deskripsi saat mengedit juga inert; klik link berbahaya tidak melakukan apa pun", async ({
    api,
    signedInPage,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await api.createBug(owner, project.slug, { title: "Bug pratinjau", description: "awal" });
    const { page } = await signedInPage(owner);
    const dialogs = recordDialogs(page);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await bug.commentInput.fill(COMPACT);
    await page.getByTestId("comment-input-tab-preview").click();
    const preview = page.getByTestId("comment-input-preview");
    await expect(preview).toContainText("<script>alert(1)</script>");
    await expect(preview.locator("script, img, iframe")).toHaveCount(0);
    await expect(preview.getByRole("link", { name: "klik" })).toHaveCount(0);

    await bug.descriptionEdit.click();
    await bug.descriptionInput.fill(COMPACT);
    await page.getByTestId("bug-description-input-tab-preview").click();
    const descriptionPreview = page.getByTestId("bug-description-input-preview");
    await expect(descriptionPreview).toContainText("<img src=x onerror=alert(1)>");
    await expect(descriptionPreview.locator("script, img, iframe")).toHaveCount(0);

    await bug.descriptionSave.click();
    await expect(bug.description).toContainText("<script>alert(1)</script>");
    // Mengklik teks "klik" (tanpa href) tidak membuka dialog atau halaman baru.
    await bug.description.getByText("klik", { exact: false }).first().click();
    await page.waitForTimeout(300);
    expect(dialogs).toHaveLength(0);
    expect(page.url()).toContain(`/bugs/1`);
  });

  test("link aman di komentar membuka tab baru tanpa opener", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await api.createBug(owner, project.slug, { title: "Bug link" });
    await api.addComment(owner, project.slug, 1, { body: "Lihat [dokumen](https://example.com/doc) dan <mailto:a@b.co>" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    const link = bug.comments.first().getByRole("link", { name: "dokumen" });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(bug.comments.first().locator('a[href="mailto:a@b.co"]')).toHaveCount(1);
  });
});
