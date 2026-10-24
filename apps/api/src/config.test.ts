import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", APP_ORIGIN: "http://localhost:5173" };

describe("loadConfig", () => {
  it("memakai nilai default", () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      appOrigin: base.APP_ORIGIN,
      cookieSecure: false,
      port: 3000,
      rateLimitMax: 10,
      trustProxy: false,
    });
  });

  it("membaca COOKIE_SECURE, PORT, RATE_LIMIT_MAX", () => {
    const config = loadConfig({ ...base, COOKIE_SECURE: "true", PORT: "8081", RATE_LIMIT_MAX: "1000" });
    expect(config).toMatchObject({ cookieSecure: true, port: 8081, rateLimitMax: 1000 });
  });

  it("melempar jika DATABASE_URL atau APP_ORIGIN kosong", () => {
    expect(() => loadConfig({ APP_ORIGIN: base.APP_ORIGIN })).toThrow("DATABASE_URL");
    expect(() => loadConfig({ DATABASE_URL: base.DATABASE_URL, APP_ORIGIN: "  " })).toThrow("APP_ORIGIN");
  });

  it("melempar jika PORT bukan bilangan bulat", () => {
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow("PORT");
  });

  describe("TRUST_PROXY", () => {
    it("tidak diisi atau kosong → false (proxy tidak dipercaya)", () => {
      expect(loadConfig(base).trustProxy).toBe(false);
      expect(loadConfig({ ...base, TRUST_PROXY: "" }).trustProxy).toBe(false);
      expect(loadConfig({ ...base, TRUST_PROXY: "  " }).trustProxy).toBe(false);
    });

    it("bilangan bulat positif → jumlah hop", () => {
      expect(loadConfig({ ...base, TRUST_PROXY: "1" }).trustProxy).toBe(1);
      expect(loadConfig({ ...base, TRUST_PROXY: " 3 " }).trustProxy).toBe(3);
    });

    it.each(["0", "-1", "1.5", "abc", "true", "false", "1,2", "10.0.0.0/8"])("melempar untuk %j", (value) => {
      expect(() => loadConfig({ ...base, TRUST_PROXY: value })).toThrow("TRUST_PROXY");
    });
  });
});
