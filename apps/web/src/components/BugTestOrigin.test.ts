import type { BugDto } from "@testpulse/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BugTestOrigin } from "./BugTestOrigin";

const TEST_CASE = { id: "11111111-1111-4111-8111-111111111111", suite: "checkout", name: "bayar" };

const render = (bug: Pick<BugDto, "testCase" | "runId" | "testHint">): string =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BugTestOrigin, { slug: "demo", bug })));

describe("BugTestOrigin", () => {
  it("tanpa run asal: keterangan netral (DTO tidak membedakan run terhapus dan tidak pernah ditautkan, Ruling F-a)", () => {
    const html = render({ testCase: TEST_CASE, runId: null, testHint: null });
    expect(html).toContain("Run asal tidak tersedia");
    expect(html).not.toContain("dihapus");
    expect(html).not.toContain('data-testid="bug-test-run-link"');
  });

  it("dengan run asal: tautan ke run, tanpa keterangan", () => {
    const html = render({ testCase: TEST_CASE, runId: "22222222-2222-4222-8222-222222222222", testHint: null });
    expect(html).toContain('href="/p/demo/runs/22222222-2222-4222-8222-222222222222"');
    expect(html).not.toContain("Run asal tidak tersedia");
  });
});
