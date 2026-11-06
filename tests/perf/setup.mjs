// Prepares data for the k6 scenarios against a running stack (Node 24, built-in fetch, no dependencies).
//   BASE_URL=http://localhost:8080 node tests/perf/setup.mjs
// Creates one user and two projects:
//   - read project (public): seeded with SEED_RUNS (>= 50) runs of 500 testcases, one per app version 0.1.0, 0.2.0, ...
//     (so /versions and /compare have a real version ordering), and SEED_BUGS (>= 100) bugs, some linked to failing
//     tests of the latest run and some resolved; read anonymously by read.js
//   - ingest project: receives the uploads of ingest.js, with INGEST_TOKENS tokens (one per VU, round-robin) so the
//     per-token upload limit (INGEST_RATE_LIMIT_MAX per hour) is never reached: the perf run must have no 429s
// Writes slug + tokens to tests/perf/.state/state.json (gitignored) which the k6 scripts read with open().
// Tokens and the password are never printed.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport } from "./make-fixture.mjs";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
// The API's CSRF check compares Origin with APP_ORIGIN (compose: http://localhost:8080).
const ORIGIN = process.env.APP_ORIGIN ?? new URL(BASE_URL).origin;
const SEED_RUNS = Number(process.env.SEED_RUNS ?? 55);
const SEED_BUGS = Number(process.env.SEED_BUGS ?? 120);
const RESOLVED_BUGS = 20;
const INGEST_TOKENS = Number(process.env.INGEST_TOKENS ?? 5);
const STATE_FILE = process.env.STATE_FILE ?? join(dirname(fileURLToPath(import.meta.url)), ".state", "state.json");
const API = `${BASE_URL}/api/v1`;

let cookie = "";

async function api(method, path, { json, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("tp_session="));
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  return res;
}

async function expect(res, status, what) {
  if (res.status !== status) throw new Error(`${what}: expected ${status}, got ${res.status} ${await res.text()}`);
  return status === 204 ? undefined : res.json();
}

async function createProject(name, visibility) {
  const project = await expect(await api("POST", "/projects", { json: { name } }), 201, `create project ${name}`);
  if (visibility === "public") {
    await expect(await api("PATCH", `/projects/${project.slug}`, { json: { visibility } }), 200, "set visibility");
  }
  return project.slug;
}

async function createToken(slug, name) {
  const created = await expect(await api("POST", `/projects/${slug}/tokens`, { json: { name } }), 201, "create token");
  return created.token;
}

async function upload(token, slug, xml, index) {
  const query = new URLSearchParams({
    branch: "main",
    commit: (index + 1).toString(16).padStart(8, "0"),
    name: `seed ${index + 1}`,
    version: `0.${index + 1}.0`,
  });
  const res = await api("POST", `/projects/${slug}/runs?${query}`, {
    body: xml,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/xml" },
  });
  return (await expect(res, 201, `seed upload ${index + 1}`)).runId;
}

const PRIORITIES = ["low", "medium", "high", "urgent"];
const SEVERITIES = ["minor", "major", "critical", "blocker"];

/** Creates SEED_BUGS bugs through the API (tester/admin session cookie + Origin, like the web app). */
async function seedBugs(slug, lastRunId) {
  const failed = await expect(await api("GET", `/projects/${slug}/runs/${lastRunId}?status=failed`), 200, "failed results");
  // One bug per failing test of the latest run (as many as the first page of failed results holds), so bug badges on
  // compare/runs are exercised; the remaining bugs have no test link. The real count is printed at the end.
  const linkable = failed.results.slice(0, SEED_BUGS - RESOLVED_BUGS);
  for (let i = 0; i < SEED_BUGS; i += 1) {
    const link = i < linkable.length ? { testCaseId: linkable[i].testCaseId, runId: lastRunId } : {};
    const bug = await expect(
      await api("POST", `/projects/${slug}/bugs`, {
        json: {
          title: `Perf bug ${String(i + 1).padStart(3, "0")}`,
          description: `Seeded by tests/perf/setup.mjs (area ${i % 5}).`,
          priority: PRIORITIES[i % PRIORITIES.length],
          severity: SEVERITIES[(i >> 2) % SEVERITIES.length],
          labels: [`area-${i % 5}`, i % 2 === 0 ? "perf" : "seed"],
          ...link,
        },
      }),
      201,
      `seed bug ${i + 1}`,
    );
    // The last RESOLVED_BUGS bugs are unlinked and resolved, so the "done" tab of the list is not empty either.
    if (i >= SEED_BUGS - RESOLVED_BUGS) {
      await expect(
        await api("PATCH", `/projects/${slug}/bugs/${bug.number}`, { json: { version: bug.version, status: "resolved", resolution: "fixed" } }),
        200,
        `resolve bug ${bug.number}`,
      );
    }
  }
  return linkable.length;
}

const suffix = randomBytes(4).toString("hex");
await expect(
  await api("POST", "/auth/register", {
    json: { name: "Perf User", email: `perf-${suffix}@perf.testpulse.dev`, password: randomBytes(18).toString("base64url") },
  }),
  201,
  "register",
);

const readSlug = await createProject(`Perf read ${suffix}`, "public");
const seedToken = await createToken(readSlug, "perf seed");
let lastRunId = "";
for (let i = 0; i < SEED_RUNS; i += 1) {
  lastRunId = await upload(seedToken, readSlug, buildReport(500, i % 13), i);
}
const linkedBugs = await seedBugs(readSlug, lastRunId);

const ingestSlug = await createProject(`Perf ingest ${suffix}`, "private");
const ingestTokens = [];
for (let i = 0; i < INGEST_TOKENS; i += 1) ingestTokens.push(await createToken(ingestSlug, `perf ingest ${i + 1}`));

mkdirSync(dirname(STATE_FILE), { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify({ readSlug, ingestSlug, ingestTokens }), { mode: 0o600 });
console.log(`perf setup done: read project "${readSlug}" with ${SEED_RUNS} versioned runs and ${SEED_BUGS} bugs (${linkedBugs} linked to failing tests), ingest project "${ingestSlug}" with ${INGEST_TOKENS} tokens`);
console.log(`state written to ${STATE_FILE}`);
