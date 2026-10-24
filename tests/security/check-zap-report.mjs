// Reads a ZAP JSON report (zap-baseline.py -J) and fails (exit 1) when it contains any High alert.
// Usage: node tests/security/check-zap-report.mjs <report.json>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RISK_NAMES = { 3: "High", 2: "Medium", 1: "Low", 0: "Informational" };

/** Counts alerts per risk code across all sites in the report. */
export function summarize(report) {
  const counts = { 3: 0, 2: 0, 1: 0, 0: 0 };
  const high = [];
  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      const code = Number(alert.riskcode);
      if (code in counts) counts[code] += 1;
      if (code === 3) high.push(alert.alert ?? alert.name ?? "(unnamed alert)");
    }
  }
  return { counts, high };
}

export function run(argv, out = console.log, err = console.error) {
  const path = argv[0];
  if (!path) {
    err("Usage: node check-zap-report.mjs <report.json>");
    return 2;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    err(`Cannot read ZAP report ${path}: ${e.message}`);
    return 2;
  }
  if (!Array.isArray(report.site)) {
    err(`${path} does not look like a ZAP report (missing "site" array)`);
    return 2;
  }
  const { counts, high } = summarize(report);
  out("ZAP alerts by risk level:");
  for (const code of [3, 2, 1, 0]) {
    out(`  ${RISK_NAMES[code]}: ${counts[code]}`);
  }
  if (high.length > 0) {
    err(`FAIL: ${high.length} High-risk alert(s): ${[...new Set(high)].join(", ")}`);
    return 1;
  }
  out("OK: no High-risk alerts");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(run(process.argv.slice(2)));
}
