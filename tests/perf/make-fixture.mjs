// Deterministic JUnit XML generator for the k6 performance scenarios.
//   node tests/perf/make-fixture.mjs   -> writes tests/perf/fixtures/report-500.xml
// setup.mjs imports buildReport() to seed runs whose outcomes differ slightly from run to run (so the read
// scenarios have real trend and flaky data). No randomness: the same arguments always give the same bytes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SUITE_COUNT = 25;

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function testcase(classname, name, timeSec, outcome) {
  const attrs = `classname="${escapeXml(classname)}" name="${escapeXml(name)}" time="${timeSec}"`;
  if (outcome === "failed") {
    const message = `Expected ${name} to succeed but the assertion failed`;
    return `<testcase ${attrs}><failure message="${escapeXml(message)}">${escapeXml(message)}</failure></testcase>`;
  }
  if (outcome === "skipped") return `<testcase ${attrs}><skipped/></testcase>`;
  return `<testcase ${attrs}/>`;
}

/**
 * JUnit report with `count` distinct testcases spread over 25 suites. Roughly 3% always fail, 4% are flaky
 * (fail once, then pass: two `<testcase>` elements with the same classname and name), 2% are skipped.
 * `variant` shifts which cases are flaky/failing so successive runs differ (flaky score, trend, failed lists).
 */
export function buildReport(count = 500, variant = 0) {
  const cases = [];
  for (let i = 0; i < count; i += 1) {
    const classname = `perf.suite${String(i % SUITE_COUNT).padStart(2, "0")}`;
    const name = `test case ${String(i).padStart(4, "0")} behaves correctly`;
    const timeSec = ((i * 7) % 90) / 100 + 0.01;
    const slot = (i + variant) % 100;
    if (slot < 3) cases.push(testcase(classname, name, timeSec, "failed"));
    else if (slot < 7) cases.push(testcase(classname, name, timeSec, "failed"), testcase(classname, name, timeSec, "passed"));
    else if (slot < 9) cases.push(testcase(classname, name, timeSec, "skipped"));
    else cases.push(testcase(classname, name, timeSec, "passed"));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="perf">${cases.join("")}</testsuite></testsuites>\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "fixtures", "report-500.xml");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildReport(500, 0));
  console.log(`wrote ${out}`);
}
