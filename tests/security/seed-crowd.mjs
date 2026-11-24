// Seeds one open crowdtesting cycle (with a crowd tester and an accepted report) for the ZAP scan of the public crowd
// pages, against a running stack (Node 24, built-in fetch, no dependencies).
//   BASE_URL=http://localhost:8080 node tests/security/seed-crowd.mjs >> "$GITHUB_OUTPUT"
// Prints `cycle_id=<uuid>` on stdout (GitHub Actions output format). Passwords are random and never printed.
import { randomBytes } from "node:crypto";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
// The API's CSRF check compares Origin with APP_ORIGIN (compose: http://localhost:8080).
const ORIGIN = process.env.APP_ORIGIN ?? new URL(BASE_URL).origin;
const API = `${BASE_URL}/api/v1`;
const suffix = randomBytes(4).toString("hex");

/** A cookie session against the API. */
function session() {
  let cookie = "";
  return async (method, path, json) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { origin: ORIGIN, ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("tp_session="));
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    return res;
  };
}

async function expect(res, status, what) {
  if (res.status !== status) throw new Error(`${what}: expected ${status}, got ${res.status} ${await res.text()}`);
  return res.json();
}

async function register(call, name) {
  const json = { name, email: `${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}@zap.testpulse.dev`, password: randomBytes(18).toString("base64url") };
  await expect(await call("POST", "/auth/register", json), 201, `register ${name}`);
}

const owner = session();
await register(owner, "ZAP Owner");
const project = await expect(await owner("POST", "/projects", { name: `ZAP crowd ${suffix}` }), 201, "create project");
const draft = await expect(
  await owner("POST", `/projects/${project.slug}/cycles`, {
    title: "ZAP cycle",
    summary: "Seeded for the ZAP baseline scan.",
    links: [{ url: "https://app.example.com", label: "App" }],
    instructions: "Coba **alur utama**.",
    environments: ["Chrome desktop"],
  }),
  201,
  "create cycle",
);
const cycle = await expect(
  await owner("PATCH", `/projects/${project.slug}/cycles/${draft.number}`, { version: draft.version, status: "open" }),
  200,
  "open cycle",
);

const tester = session();
await register(tester, "ZAP Tester");
await expect(await tester("POST", `/crowd/cycles/${cycle.id}/join`, { acceptRules: true }), 200, "join cycle");
const report = await expect(
  await tester("POST", `/crowd/cycles/${cycle.id}/reports`, {
    title: "Tombol bayar tidak merespons",
    steps: "1. Buka keranjang\n2. Klik Bayar",
    expected: "Pembayaran terbuka",
    actual: "Tidak terjadi apa-apa",
    environment: "Chrome 130",
    suggestedSeverity: "major",
  }),
  201,
  "submit report",
);
await expect(
  await owner("POST", `/projects/${project.slug}/crowd-reports/${report.number}/triage`, { version: report.version, decision: "accept" }),
  200,
  "accept report",
);

console.log(`cycle_id=${cycle.id}`);
