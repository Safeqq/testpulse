import { describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, rateLimitKey } from "./client-ip.js";

const SECRET = "s3cret-value-for-tests";
const peer = "10.0.0.7";

function keyFor(config: { proxySecret?: string }, headers: Record<string, string | string[] | undefined>): string {
  return rateLimitKey(config)({ headers, ip: peer });
}

describe("rateLimitKey", () => {
  it("secret cocok: memakai x-tp-client-ip (dipangkas)", () => {
    const headers = { [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: " 203.0.113.9 " };
    expect(keyFor({ proxySecret: SECRET }, headers)).toBe("203.0.113.9");
  });

  it("secret cocok: X-Forwarded-For tidak pernah dibaca, bahkan jika berbeda dari x-tp-client-ip", () => {
    const headers = {
      [PROXY_SECRET_HEADER]: SECRET,
      [CLIENT_IP_HEADER]: "203.0.113.9",
      "x-forwarded-for": "198.51.100.1, 10.1.2.3",
    };
    expect(keyFor({ proxySecret: SECRET }, headers)).toBe("203.0.113.9");
  });

  it.each([
    ["tidak ada", undefined],
    ["kosong", ""],
    ["hanya spasi", "   "],
    ["lebih dari satu nilai", "203.0.113.9, 198.51.100.1"],
    ["header ganda (array)", ["203.0.113.9", "198.51.100.1"]],
  ])("secret cocok tetapi x-tp-client-ip %s: jatuh ke req.ip (X-Forwarded-For diabaikan)", (_name, value) => {
    const headers = { [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: value, "x-forwarded-for": "6.6.6.6" };
    expect(keyFor({ proxySecret: SECRET }, headers)).toBe(peer);
  });

  it.each([
    ["header tidak ada", undefined],
    ["header kosong", ""],
    ["secret salah", "salah"],
    ["secret salah dengan panjang sama", "x".repeat(SECRET.length)],
    ["secret lebih panjang", `${SECRET}-tambahan`],
    ["header ganda", [SECRET, SECRET]],
  ])("%s: x-tp-client-ip dan X-Forwarded-For diabaikan", (_name, provided) => {
    const headers = { [PROXY_SECRET_HEADER]: provided, [CLIENT_IP_HEADER]: "6.6.6.6", "x-forwarded-for": "7.7.7.7" };
    expect(keyFor({ proxySecret: SECRET }, headers)).toBe(peer);
  });

  it("PROXY_SECRET tidak dikonfigurasi: x-tp-client-ip dan header secret diabaikan", () => {
    const headers = { [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: "6.6.6.6", "x-forwarded-for": "7.7.7.7" };
    expect(keyFor({}, headers)).toBe(peer);
    expect(keyFor({}, { [PROXY_SECRET_HEADER]: "", [CLIENT_IP_HEADER]: "6.6.6.6" })).toBe(peer);
  });
});
