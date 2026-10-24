import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
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
