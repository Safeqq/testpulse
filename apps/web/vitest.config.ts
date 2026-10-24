import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // JUnit XML in the Allure results dir: allure-vitest does not support Vitest 5 (@vitest/runner was folded into vitest).
    // CI sets ALLURE_JOB so each job writes a distinct file and merged results do not collide.
    reporters: [
      "default",
      ["junit", { outputFile: `allure-results/junit-web-${process.env.ALLURE_JOB ?? "local"}.xml` }],
    ],
    projects: [
      {
        test: {
          name: "functions",
          environment: "node",
          // Pages Function proxy dan paritas header keamanan (nginx vs _headers).
          include: ["test/functions/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "contract",
          environment: "node",
          include: ["test/contract/**/*.pact.test.ts"],
          globalSetup: ["test/contract/setup/global-setup.ts"],
          // Semua file menulis ke satu file pact (consumer + provider yang sama); jalankan berurutan.
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
    ],
  },
});
