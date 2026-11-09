import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BugManualOrigin } from "./BugManualOrigin";

const ORIGIN = {
  runNumber: 3,
  runName: "Regresi rilis",
  caseNumber: 12,
  caseTitle: "Bayar dengan kartu",
  runCaseId: "44444444-4444-4444-8444-444444444444",
};

const render = (manualOrigin: typeof ORIGIN | null): string =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BugManualOrigin, { slug: "demo proj", bug: { manualOrigin } })));

describe("BugManualOrigin", () => {
  it("menampilkan TR-3 · TC-12 dengan tautan ke halaman eksekusi run case", () => {
    const html = render(ORIGIN);
    expect(html).toContain('data-testid="bug-manual-origin"');
    expect(html).toContain("Dari test run manual");
    expect(html).toContain("TR-3 · TC-12");
    expect(html).toContain('href="/p/demo%20proj/manual-runs/3/cases/44444444-4444-4444-8444-444444444444"');
    expect(html).toContain("Bayar dengan kartu");
    expect(html).toContain("Regresi rilis");
  });

  it("tanpa asal manual tidak merender apa pun", () => {
    expect(render(null)).toBe("");
  });
});
