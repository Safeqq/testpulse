import path from "node:path";
import { MatchersV3, PactV4, type V3MockServer } from "@pact-foundation/pact";
import { createApiClient, type ApiClient } from "../../src/lib/api.js";

export const CONSUMER = "testpulse-web";
export const PROVIDER = "testpulse-api";

/** Pact ditulis ke `pacts/` di root repo (di-gitignore, dibuat ulang di CI). */
export const PACTS_DIR = path.resolve(import.meta.dirname, "../../../../pacts");
export const PACT_FILE = path.join(PACTS_DIR, `${CONSUMER}-${PROVIDER}.json`);

/** Token sesi palsu; provider mengganti dengan token sesi asli milik user pada provider state. */
export const SESSION_COOKIE = "tp_session=pact-token";

// Id tetap yang dibuat provider state; dipakai di path request.
export const BUDI_ID = "11111111-1111-4111-8111-111111111111";
export const SARI_ID = "22222222-2222-4222-8222-222222222222";
export const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
export const INVITE_TOKEN = "pact-invite-token";
export const EXPIRED_INVITE_TOKEN = "pact-expired-token";

export const PROJECT_SLUG = "pact-project";
export const PUBLIC_SLUG = "pact-public";

export const STATE = {
  noUser: "tidak ada user",
  budiRegistered: "user budi@pact.dev terdaftar",
  budiLoggedIn: "budi login",
  budiAdmin: "budi admin project pact-project",
  publicProject: "project publik pact-public ada",
  invitation: "undangan pact-invite-token aktif untuk pact-project",
  expiredInvitation: "undangan pact-expired-token kedaluwarsa untuk pact-project",
  sariTester: "sari anggota tester di pact-project",
} as const;

const { like, uuid, regex, iso8601DateTimeWithMillis } = MatchersV3;

// Matcher bertipe: kontrak tidak bergantung pada nilai acak (id, waktu, token).
export const uuidLike = (example: string) => uuid(example);
export const dateTime = (example = "2026-01-01T00:00:00.000Z") => iso8601DateTimeWithMillis(example);
export const slugLike = (example: string) => regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, example);
export const text = (example: string) => like(example);

export function createPact(): PactV4 {
  return new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir: PACTS_DIR, logLevel: "warn" });
}

/**
 * Membuat klien web asli yang diarahkan ke mock server Pact. Baseurl memakai prefix `/api`
 * sehingga path menjadi `/api/v1/...` seperti pada API sebenarnya. Jika `loggedIn`, setiap
 * request membawa cookie sesi palsu (browser melakukannya lewat `credentials: "include"`).
 */
export function clientFor(mockServer: V3MockServer, loggedIn = false): ApiClient {
  const fetchFn: typeof fetch = (input, init) => {
    if (!loggedIn) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("cookie", SESSION_COOKIE);
    return fetch(input, { ...init, headers });
  };
  return createApiClient(`${mockServer.url}/api`, fetchFn);
}

export const JSON_HEADERS = { "Content-Type": "application/json" };
export const COOKIE_HEADERS = { Cookie: SESSION_COOKIE };
export const JSON_COOKIE_HEADERS = { ...JSON_HEADERS, ...COOKIE_HEADERS };

export function errorBody(code: string, message: string, fields?: Record<string, string>) {
  return {
    error: {
      code,
      message: like(message),
      ...(fields ? { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, like(v)])) } : {}),
    },
  };
}
