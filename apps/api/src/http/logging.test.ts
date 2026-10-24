import { describe, expect, it } from "vitest";
import { redactUrl, serializeRequest } from "./logging.js";

describe("redactUrl", () => {
  it("menyensor segmen token pada pratinjau dan accept, mempertahankan sisanya", () => {
    expect(redactUrl("/api/v1/invitations/abc_DEF-123")).toBe("/api/v1/invitations/[REDACTED]");
    expect(redactUrl("/api/v1/invitations/abc_DEF-123/accept")).toBe("/api/v1/invitations/[REDACTED]/accept");
    expect(redactUrl("/api/v1/invitations/abc?x=1")).toBe("/api/v1/invitations/[REDACTED]?x=1");
  });

  it("tidak menyentuh URL lain, termasuk id undangan di path project", () => {
    for (const url of [
      "/api/v1/projects/demo/invitations/11111111-1111-4111-8111-111111111111",
      "/api/v1/projects/demo/invitations",
      "/api/v1/invitations",
      "/api/health",
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });
});

describe("serializeRequest", () => {
  it("mempertahankan field request lain dan menyensor url", () => {
    const out = serializeRequest({
      method: "POST",
      url: "/api/v1/invitations/rahasia/accept",
      headers: { "accept-version": "1.0.0" },
      host: "localhost",
      ip: "127.0.0.1",
    });
    expect(out).toEqual({
      method: "POST",
      url: "/api/v1/invitations/[REDACTED]/accept",
      version: "1.0.0",
      host: "localhost",
      remoteAddress: "127.0.0.1",
      remotePort: undefined,
    });
  });
});
