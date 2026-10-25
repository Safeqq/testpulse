import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { run, summarize } from "./check-zap-report.mjs";

const dir = mkdtempSync(join(tmpdir(), "zap-check-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function reportFile(name, alerts) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ site: [{ "@name": "http://web:8080", alerts }] }));
  return path;
}

function runCapture(argv) {
  const out = [];
  const err = [];
  const code = run(argv, (l) => out.push(l), (l) => err.push(l));
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("check-zap-report", () => {
  it("passes when there are only Medium/Low/Informational alerts", () => {
    const path = reportFile("ok.json", [
      { alert: "CSP", riskcode: "2" },
      { alert: "Cookie flag", riskcode: "1" },
      { alert: "Info", riskcode: "0" },
    ]);
    const { code, out } = runCapture([path]);
    assert.equal(code, 0);
    assert.match(out, /High: 0/);
    assert.match(out, /Medium: 1/);
  });

  it("fails and names the alert when a High alert exists", () => {
    const path = reportFile("high.json", [{ alert: "SQL Injection", riskcode: "3" }]);
    const { code, err } = runCapture([path]);
    assert.equal(code, 1);
    assert.match(err, /SQL Injection/);
  });

  it("counts alerts per risk level across sites", () => {
    const { counts } = summarize({
      site: [
        { alerts: [{ riskcode: "3" }, { riskcode: "1" }] },
        { alerts: [{ riskcode: "1" }] },
      ],
    });
    assert.deepEqual(counts, { 3: 1, 2: 0, 1: 2, 0: 0 });
  });

  it("treats a report with no alerts as passing", () => {
    assert.equal(runCapture([reportFile("empty.json", [])]).code, 0);
  });

  it("returns 2 when the report has no scanned sites (empty scan must not pass)", () => {
    const path = join(dir, "no-sites.json");
    writeFileSync(path, JSON.stringify({ site: [] }));
    const { code, err } = runCapture([path]);
    assert.equal(code, 2);
    assert.match(err, /no scanned sites/);
  });

  it("returns 2 for missing arguments, unreadable files and non-ZAP JSON", () => {
    assert.equal(runCapture([]).code, 2);
    assert.equal(runCapture([join(dir, "missing.json")]).code, 2);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{}");
    assert.equal(runCapture([bad]).code, 2);
  });
});
