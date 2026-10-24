import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "./client.js";

// Neon mewajibkan TLS dan memberi connection string berakhiran `?sslmode=require`.
// createDb meneruskan URL apa adanya ke pg, jadi test ini mengunci perilaku pg untuk URL tersebut.
const neonUrl = "postgres://user:pw@ep-cool-name-123456.eu-central-1.aws.neon.tech/testpulse?sslmode=require";

/** Nilai `ssl` yang dihitung pg dari connection string (`connectionParameters` tidak ada di tipe publik). */
function sslFor(connectionString: string): unknown {
  const client = new pg.Client({ connectionString }) as unknown as { connectionParameters: { ssl: unknown } };
  return client.connectionParameters.ssl;
}

describe("createDb dan TLS (Neon)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sslmode=require mengaktifkan TLS pada koneksi pg", () => {
    // pg memperingatkan bahwa mode ini adalah alias verify-full; peringatan itu tidak relevan bagi test.
    vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    expect(sslFor(neonUrl)).toBeTruthy();
  });

  it("sslmode=verify-full mengaktifkan TLS dengan verifikasi sertifikat", () => {
    const url = neonUrl.replace("sslmode=require", "sslmode=verify-full");
    expect(sslFor(url)).toBeTruthy();
  });

  it("URL lokal tanpa sslmode tidak memakai TLS", () => {
    const url = "postgres://testpulse:testpulse@localhost:5432/testpulse";
    expect(sslFor(url)).toBe(false);
  });

  it("membuat pool dari URL Neon tanpa membuka koneksi", async () => {
    vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const { pool } = createDb(neonUrl);
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });
});
