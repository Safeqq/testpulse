import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // JUnit XML in the Allure results dir: allure-vitest does not support Vitest 5 (@vitest/runner was folded into vitest).
    // CI sets ALLURE_JOB so each job writes a distinct file and merged results do not collide.
    reporters: [
      "default",
      ["junit", { outputFile: `allure-results/junit-api-${process.env.ALLURE_JOB ?? "local"}.xml` }],
    ],
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.int.test.ts"],
          globalSetup: ["test/integration/setup/global-setup.ts"],
          testTimeout: 30000,
          hookTimeout: 120000,
        },
      },
      {
        test: {
          name: "contract",
          include: ["test/contract/**/*.pact.test.ts"],
          globalSetup: ["test/integration/setup/global-setup.ts"],
          testTimeout: 120000,
          hookTimeout: 120000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/modules/**/domain/**"],
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
