import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

/** Nilai header dari `add_header Nama "nilai" always;` pada snippet nginx. */
function parseNginx(source: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const match of source.matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"(?:\s+always)?\s*;/gm)) {
    headers[match[1]!.toLowerCase()] = match[2]!;
  }
  return headers;
}

/** Nilai header dari file `_headers` Cloudflare Pages (satu blok `/*`). */
function parsePagesHeaders(source: string): { paths: string[]; headers: Record<string, string> } {
  const paths: string[] = [];
  const headers: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      paths.push(raw.trim());
      continue;
    }
    const separator = raw.indexOf(":");
    headers[raw.slice(0, separator).trim().toLowerCase()] = raw.slice(separator + 1).trim();
  }
  return { paths, headers };
}

const expectedNames = ["content-security-policy", "x-content-type-options", "referrer-policy", "permissions-policy"];

describe("header keamanan: nginx dan Cloudflare Pages harus identik (ruling R4)", () => {
  const nginx = parseNginx(read("../../security-headers.conf"));
  const pages = parsePagesHeaders(read("../../public/_headers"));

  it("keduanya memuat tepat empat header yang sama", () => {
    expect(Object.keys(nginx).sort()).toEqual([...expectedNames].sort());
    expect(Object.keys(pages.headers).sort()).toEqual([...expectedNames].sort());
  });

  it("_headers berlaku untuk semua path", () => {
    expect(pages.paths).toEqual(["/*"]);
  });

  it.each(expectedNames)("nilai %s sama persis", (name) => {
    expect(pages.headers[name]).toBeTruthy();
    expect(pages.headers[name]).toBe(nginx[name]);
  });
});
