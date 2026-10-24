import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
