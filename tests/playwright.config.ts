import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Batas lokal: 3 browser × banyak worker membuat Firefox tidak stabil saat menutup context di mesin ramai.
  workers: process.env.CI ? undefined : 4,
  reporter: [["list"], ["allure-playwright", { resultsDir: "allure-results" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "api", testDir: "api" },
    { name: "e2e-chromium", testDir: "e2e", use: { browserName: "chromium" } },
    { name: "e2e-firefox", testDir: "e2e", use: { browserName: "firefox" } },
    { name: "e2e-webkit", testDir: "e2e", use: { browserName: "webkit" } },
    { name: "smoke", testDir: "smoke" },
  ],
  // Tanpa BASE_URL: jalankan stack dev lokal (shared tsc -w + API + Vite) dan tunggu API siap lewat proxy.
  // Dengan BASE_URL (CI/Docker/production): stack sudah disediakan di luar.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        cwd: "..",
        url: "http://localhost:5173/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      },
});
