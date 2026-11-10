// @ts-check
// Mutation testing on the pure domain code (spec Tahap 4 §9).
//
// Command runner instead of @stryker-mutator/vitest-runner: with this package's Vitest 5 setup the vitest runner never
// activated static mutants (module-level tables such as the bug transition table or the permission sets) and reported
// every one of them as survived; a fresh `vitest run` per mutant kills them. Only the unit project runs: the
// integration and contract projects need Docker (Testcontainers) and add nothing for domain mutants.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  // pnpm does not hoist plugins next to @stryker-mutator/core, so they are listed explicitly.
  plugins: ["@stryker-mutator/typescript-checker"],
  testRunner: "command",
  commandRunner: { command: "pnpm exec vitest run --project unit" },
  coverageAnalysis: "off",
  // Every mutant starts a fresh Vitest process; with all workers busy one run takes far longer than the lone dry run,
  // and the default allowance (dry run x 1.5 + 5 s) reported healthy runs as timeouts (which count as killed).
  // Four workers keep that contention low (a GitHub runner has four vCPUs).
  concurrency: 4,
  timeoutMS: 30000,
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  mutate: ["src/modules/**/domain/**/*.ts", "!**/*.test.ts"],
  thresholds: { high: 90, low: 80, break: 80 },
  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  ignorePatterns: ["allure-results", "coverage", "dist", "reports"],
};
