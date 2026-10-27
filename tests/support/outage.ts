import type { Page } from "@playwright/test";

const unavailable = { error: { code: "INTERNAL_ERROR", message: "Layanan sedang tidak tersedia" } };

/**
 * Menjawab 503 untuk /auth/me selama `outage.active`, lalu meneruskan ke API sungguhan. Berbasis keadaan, bukan
 * hitungan panggilan: dev server (React StrictMode) memanggil /auth/me dua kali saat halaman dibuka.
 */
export async function simulateMeOutage(page: Page): Promise<{ active: boolean; calls: number }> {
  const outage = { active: true, calls: 0 };
  await page.route("**/api/v1/auth/me", async (route) => {
    outage.calls += 1;
    if (outage.active) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify(unavailable) });
    } else {
      await route.continue();
    }
  });
  return outage;
}
