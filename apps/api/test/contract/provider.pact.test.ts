import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Verifier } from "@pact-foundation/pact";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createDb } from "../../src/db/client.js";
import { createContractStates, type ContractStates } from "./states.js";

const PACT_FILE = path.resolve(import.meta.dirname, "../../../../pacts/testpulse-web-testpulse-api.json");

describe("verifikasi kontrak provider (testpulse-api)", () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let baseUrl: string;
  let states: ContractStates;

  beforeAll(async () => {
    if (!existsSync(PACT_FILE)) {
      throw new Error(`File pact tidak ditemukan: ${PACT_FILE}. Jalankan test consumer dulu (pnpm test:contract).`);
    }
    const created = createDb(inject("databaseUrl"));
    pool = created.pool;
    states = createContractStates(created.db);
    app = await buildApp(
      {
        databaseUrl: inject("databaseUrl"),
        appOrigin: "http://localhost:5173",
        cookieSecure: false,
        port: 0,
        rateLimitMax: 1000,
      },
      { db: created.db, logLevel: "silent" },
    );
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("semua interaksi dari consumer testpulse-web terverifikasi", async () => {
    const output = await new Verifier({
      provider: "testpulse-api",
      providerBaseUrl: baseUrl,
      pactUrls: [PACT_FILE],
      stateHandlers: states.stateHandlers,
      beforeEach: states.beforeEach,
      requestFilter: states.requestFilter,
      logLevel: "warn",
    }).verifyProvider();
    expect(output).toBeTruthy();
  });
});
