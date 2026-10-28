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
      ingestRateLimitMax: 60,
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

  describe("INGEST_RATE_LIMIT_MAX", () => {
    it("default 60, dibaca dari env bila diisi", () => {
      expect(loadConfig(base).ingestRateLimitMax).toBe(60);
      expect(loadConfig({ ...base, INGEST_RATE_LIMIT_MAX: " 1000 " }).ingestRateLimitMax).toBe(1000);
    });

    it.each(["0", "-1", "1.5", "abc"])("melempar untuk nilai bukan bilangan bulat > 0 (%s)", (value) => {
      expect(() => loadConfig({ ...base, INGEST_RATE_LIMIT_MAX: value })).toThrow("INGEST_RATE_LIMIT_MAX");
    });
  });

  describe("APP_ORIGIN", () => {
    const origin = (value: string) => loadConfig({ ...base, APP_ORIGIN: value }).appOrigin;

    it("menyimpan origin bersih apa adanya", () => {
      expect(origin("http://localhost:5173")).toBe("http://localhost:5173");
      expect(origin("https://x.pages.dev")).toBe("https://x.pages.dev");
    });

    it("membuang satu garis miring di akhir dan spasi", () => {
      expect(origin("https://x.pages.dev/")).toBe("https://x.pages.dev");
      expect(origin("  https://x.pages.dev/  ")).toBe("https://x.pages.dev");
    });

    it.each([
      ["path", "https://x.pages.dev/app"],
      ["path dengan garis miring akhir", "https://x.pages.dev/app/"],
      ["dua garis miring di akhir", "https://x.pages.dev//"],
      ["query", "https://x.pages.dev?a=1"],
      ["hash", "https://x.pages.dev/#top"],
      ["skema bukan http(s)", "ftp://x"],
      ["bukan URL", "not a url"],
      ["tanpa skema", "x.pages.dev"],
      ["kredensial", "https://user:pw@x.pages.dev"],
    ])("melempar error yang jelas untuk %s", (_name, value) => {
      expect(() => origin(value)).toThrow(/APP_ORIGIN/);
    });
  });

  describe("PROXY_SECRET", () => {
    it("tidak diisi atau kosong → fitur mati (properti tidak ada)", () => {
      expect(loadConfig(base)).not.toHaveProperty("proxySecret");
      expect(loadConfig({ ...base, PROXY_SECRET: "" })).not.toHaveProperty("proxySecret");
      expect(loadConfig({ ...base, PROXY_SECRET: "   " })).not.toHaveProperty("proxySecret");
    });

    it("diisi → dipakai (dipangkas)", () => {
      expect(loadConfig({ ...base, PROXY_SECRET: "  abc123  " }).proxySecret).toBe("abc123");
    });
  });

  describe("RENDER_GIT_COMMIT", () => {
    it("tidak diisi atau kosong → properti tidak ada", () => {
      expect(loadConfig(base)).not.toHaveProperty("gitCommit");
      expect(loadConfig({ ...base, RENDER_GIT_COMMIT: " " })).not.toHaveProperty("gitCommit");
    });

    it("diisi → dipakai (dipangkas)", () => {
      expect(loadConfig({ ...base, RENDER_GIT_COMMIT: " abc123def " }).gitCommit).toBe("abc123def");
    });
  });
});
