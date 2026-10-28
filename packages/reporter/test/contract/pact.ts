import path from "node:path";
import { PactV4 } from "@pact-foundation/pact";

export const CONSUMER = "testpulse-reporter";
export const PROVIDER = "testpulse-api";

/** Pact ditulis ke `pacts/` di root repo (di-gitignore, dibuat ulang di CI), bersama pact consumer web. */
export const PACTS_DIR = path.resolve(import.meta.dirname, "../../../../pacts");
export const PACT_FILE = path.join(PACTS_DIR, `${CONSUMER}-${PROVIDER}.json`);

export const PROJECT_SLUG = "testpulse";

/**
 * Token CI tetap untuk kontrak (bentuk `tp_` + 43 karakter base64url). Provider state membuat token aktif
 * dengan hash SHA-256 nilai ini; nilai yang sama ada di apps/api/test/contract/states.ts.
 */
export const INGEST_TOKEN = "tp_pact-ingest-token-for-contract-tests-A1B2C3";
/** Berbentuk sah tetapi tidak terdaftar di provider (tidak ada state). */
export const UNKNOWN_TOKEN = "tp_unknown-ingest-token-for-contract-ts-Z9Y8X7";

export const STATE = {
  activeToken: "project testpulse punya token aktif pact-ingest-token",
} as const;

export function createPact(): PactV4 {
  return new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir: PACTS_DIR, logLevel: "warn" });
}
