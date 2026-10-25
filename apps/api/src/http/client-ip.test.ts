import { describe, expect, it } from "vitest";
import { PROXY_SECRET_HEADER, rateLimitKey } from "./client-ip.js";

const SECRET = "s3cret-value-for-tests";
const peer = "10.0.0.7";

function keyFor(config: { proxySecret?: string }, headers: Record<string, string | string[] | undefined>): string {
  return rateLimitKey(config)({ headers, ip: peer });
}

describe("rateLimitKey", () => {
  it("secret cocok: memakai entri pertama X-Forwarded-For (dipangkas)", () => {
    const headers = { [PROXY_SECRET_HEADER]: SECRET, "x-forwarded-for": " 203.0.113.9 , 198.51.100.1" };
    expect(keyFor({ proxySecret: SECRET }, headers)).toBe("203.0.113.9");
  });

  it("secret cocok tetapi X-Forwarded-For kosong atau tidak ada: jatuh ke req.ip", () => {
    expect(keyFor({ proxySecret: SECRET }, { [PROXY_SECRET_HEADER]: SECRET })).toBe(peer);
    expect(keyFor({ proxySecret: SECRET }, { [PROXY_SECRET_HEADER]: SECRET, "x-forwarded-for": "  " })).toBe(peer);
    expect(keyFor({ proxySecret: SECRET }, { [PROXY_SECRET_HEADER]: SECRET, "x-forwarded-for": ", 1.1.1.1" })).toBe(peer);
  });

  it.each([
    ["header tidak ada", undefined],
    ["header kosong", ""],
    ["secret salah", "salah"],
    ["secret salah dengan panjang sama", "x".repeat(SECRET.length)],
    ["secret lebih panjang", `${SECRET}-tambahan`],
    ["header ganda", [SECRET, SECRET]],
  ])("%s: X-Forwarded-For diabaikan", (_name, provided) => {
    const headers = { [PROXY_SECRET_HEADER]: provided, "x-forwarded-for": "6.6.6.6" };
    expect(keyFor({ proxySecret: SECRET }, headers)).toBe(peer);
  });

  it("PROXY_SECRET tidak dikonfigurasi: X-Forwarded-For dan header secret diabaikan", () => {
    const headers = { [PROXY_SECRET_HEADER]: SECRET, "x-forwarded-for": "6.6.6.6" };
    expect(keyFor({}, headers)).toBe(peer);
    expect(keyFor({}, { [PROXY_SECRET_HEADER]: "", "x-forwarded-for": "6.6.6.6" })).toBe(peer);
  });
});
