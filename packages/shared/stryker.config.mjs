// @ts-check
// Mutation testing on the shared logic files (spec Tahap 4 §9; manual-logic.ts per ruling R1). The schemas are
// declarative zod objects and are not mutated.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  // pnpm does not hoist the plugins next to @stryker-mutator/core, so they are listed explicitly.
  plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  mutate: ["src/slug.ts", "src/roles.ts", "src/manual-logic.ts"],
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  ignorePatterns: ["allure-results", "dist", "reports"],
};
