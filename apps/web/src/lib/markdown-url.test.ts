import { describe, expect, it } from "vitest";
import { safeMarkdownUrl } from "./markdown-url";

describe("safeMarkdownUrl", () => {
  it.each([
    "https://x.io",
    "http://x.io/a?b=c#d",
    "mailto:a@b.c",
    "HTTPS://X.IO/Path",
  ])("meneruskan %s tanpa perubahan", (url) => {
    expect(safeMarkdownUrl(url)).toBe(url);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    [" javascript:alert(1)"],
    ["\tjavascript:alert(1)"],
    ["java\nscript:alert(1)"],
    ["\u0001javascript:alert(1)"],
    ["data:text/html;base64,PHNjcmlwdD4="],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["ftp://x.io/f"],
    ["blob:https://x.io/uuid"],
    ["//evil.example/path"],
    ["/relatif/path"],
    ["../relatif"],
    ["#anchor"],
    ["?q=1"],
    [""],
    ["   "],
    ["bukan url"],
  ])("membuang %j", (url) => {
    expect(safeMarkdownUrl(url)).toBeNull();
  });
});
