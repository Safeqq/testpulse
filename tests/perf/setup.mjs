// Prepares data for the k6 scenarios against a running stack (Node 24, built-in fetch, no dependencies).
//   BASE_URL=http://localhost:8080 node tests/perf/setup.mjs
// Creates one user and two projects:
//   - read project (public): seeded with SEED_RUNS (>= 50) runs of 500 testcases, one per app version 0.1.0, 0.2.0, ...
//     (so /versions and /compare have a real version ordering), and SEED_BUGS (>= 100) bugs, some linked to failing
//     tests of the latest run and some resolved; read anonymously by read.js
//     Tahap 4: also MANUAL_SUITES (>= 10) suites holding MANUAL_CASES (>= 200) manual cases, and one manual run of the first
//     MANUAL_RUN_CASES (200) cases, versioned like the latest CI run (so /versions has a Manual column) and partly executed
//     (MANUAL_EXECUTED of them get a result; the rest stay untested)
//   - crowd project (public): Tahap 5 crowdtesting data for the /crowd read endpoints: CROWD_CYCLES (>= 20) open cycles,
//     CROWD_TESTERS (>= 200) crowd testers (each joins two cycles) and CROWD_REPORTS (>= 1000) reports, all accepted by
//     the team, spread evenly over the cycles and testers
//   - ingest project: receives the uploads of ingest.js, with INGEST_TOKENS tokens (one per VU, round-robin) so the
//     per-token upload limit (INGEST_RATE_LIMIT_MAX per hour) is never reached: the perf run must have no 429s
// Writes slug + tokens + manualRunNumber + crowdCycleIds to tests/perf/.state/state.json (gitignored) which the k6 scripts read with open().
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
const MANUAL_SUITES = Number(process.env.MANUAL_SUITES ?? 12);
const MANUAL_CASES = Number(process.env.MANUAL_CASES ?? 240);
const MANUAL_RUN_CASES = 200;
const MANUAL_EXECUTED = 120;
const INGEST_TOKENS = Number(process.env.INGEST_TOKENS ?? 5);
const CROWD_CYCLES = Number(process.env.CROWD_CYCLES ?? 25);
const CROWD_TESTERS = Number(process.env.CROWD_TESTERS ?? 200);
const CROWD_REPORTS = Number(process.env.CROWD_REPORTS ?? 1000);
const STATE_FILE = process.env.STATE_FILE ?? join(dirname(fileURLToPath(import.meta.url)), ".state", "state.json");
const API = `${BASE_URL}/api/v1`;

/**
 * A cookie session against the API (Origin header for the CSRF check). Write routes are rate limited per minute, so a
 * 429 waits and retries instead of failing the seed.
 */
function session() {
  let cookie = "";
  return async function call(method, path, { json, body, headers = {} } = {}) {
    for (let attempt = 0; ; attempt += 1) {
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
      if (res.status !== 429 || attempt >= 30) return res;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  };
}

const api = session();

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

/** Runs `task` for every item, `size` at a time (the API handles parallel requests; this only bounds the load). */
async function inBatches(items, size, task) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(task));
}

/**
 * Tahap 4 data through the API: MANUAL_SUITES suites with MANUAL_CASES cases of three steps each (spread over the
 * suites; case numbers TC-1..), one run of the first MANUAL_RUN_CASES cases named after the latest CI version, and
 * MANUAL_EXECUTED run cases with a result (mostly passed, some failed, blocked and skipped). Returns the run number.
 */
async function seedManual(slug, appVersion) {
  const suiteIds = [];
  for (let i = 0; i < MANUAL_SUITES; i += 1) {
    const suite = await expect(
      await api("POST", `/projects/${slug}/suites`, { json: { name: `Perf suite ${String(i + 1).padStart(2, "0")}`, description: "Seeded by tests/perf/setup.mjs." } }),
      201,
      `seed suite ${i + 1}`,
    );
    suiteIds.push(suite.id);
  }
  const caseNumbers = [];
  for (let i = 0; i < MANUAL_CASES; i += 1) {
    const created = await expect(
      await api("POST", `/projects/${slug}/cases`, {
        json: {
          suiteId: suiteIds[i % MANUAL_SUITES],
          title: `Perf case ${String(i + 1).padStart(3, "0")} berjalan benar`,
          preconditions: "Pengguna sudah masuk dan project berisi data contoh.",
          steps: [
            { action: "Buka halaman yang diuji", expected: "Halaman tampil tanpa galat" },
            { action: `Isi formulir dengan data contoh ${i + 1}`, expected: "Isian diterima" },
            { action: "Kirim formulir", expected: "Hasil tampil dan tersimpan" },
          ],
          priority: PRIORITIES[i % PRIORITIES.length],
          labels: [`area-${i % 5}`],
        },
      }),
      201,
      `seed case ${i + 1}`,
    );
    caseNumbers.push(created.number);
  }

  const run = await expect(
    await api("POST", `/projects/${slug}/manual-runs`, {
      json: { name: "Regresi perf", appVersion, caseNumbers: caseNumbers.slice(0, MANUAL_RUN_CASES) },
    }),
    201,
    "seed manual run",
  );

  // First two pages of run cases (100 each) give the 200 ids; execute the first MANUAL_EXECUTED of them.
  const runCases = [];
  let cursor = "";
  do {
    const page = await expect(
      await api("GET", `/projects/${slug}/manual-runs/${run.number}/cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
      200,
      "list run cases",
    );
    runCases.push(...page.items);
    cursor = page.nextCursor ?? "";
  } while (cursor);
  const statusFor = (i) => (i % 40 === 39 ? "skipped" : i % 25 === 24 ? "blocked" : i % 10 === 9 ? "failed" : "passed");
  await inBatches(runCases.slice(0, MANUAL_EXECUTED).map((runCase, i) => ({ runCase, i })), 10, async ({ runCase, i }) => {
    const detail = await expect(await api("GET", `/projects/${slug}/manual-runs/${run.number}/cases/${runCase.id}`), 200, "run case");
    await expect(
      await api("PATCH", `/projects/${slug}/manual-runs/${run.number}/cases/${runCase.id}`, { json: { version: detail.version, status: statusFor(i) } }),
      200,
      `execute run case ${i + 1}`,
    );
  });
  return run.number;
}

/**
 * Tahap 5 data: CROWD_CYCLES open cycles in a public project, CROWD_TESTERS crowd testers (not project members) who each
 * join two neighbouring cycles, and CROWD_REPORTS reports accepted right after submission (so no tester ever has more
 * than one report waiting for triage). Reports rotate over testers and their two cycles, so every cycle gets about
 * CROWD_REPORTS / CROWD_CYCLES accepted reports and the global leaderboard is full. Returns the cycle ids.
 */
async function seedCrowd(slug) {
  const cycleIds = [];
  for (let i = 0; i < CROWD_CYCLES; i += 1) {
    const draft = await expect(
      await api("POST", `/projects/${slug}/cycles`, {
        json: {
          title: `Perf cycle ${String(i + 1).padStart(2, "0")}`,
          summary: "Seeded by tests/perf/setup.mjs.",
          links: [{ url: "https://app.example.com", label: "App" }],
          instructions: "Coba alur utama.",
          environments: ["Chrome desktop", "Android"],
        },
      }),
      201,
      `seed cycle ${i + 1}`,
    );
    const open = await expect(
      await api("PATCH", `/projects/${slug}/cycles/${draft.number}`, { json: { version: draft.version, status: "open" } }),
      200,
      `open cycle ${i + 1}`,
    );
    cycleIds.push(open.id);
  }
  const testers = [];
  await inBatches([...Array(CROWD_TESTERS).keys()], 10, async (t) => {
    const call = session();
    await expect(
      await call("POST", "/auth/register", {
        json: { name: `Crowd ${String(t + 1).padStart(3, "0")}`, email: `crowd-${suffix}-${t}@perf.testpulse.dev`, password: randomBytes(18).toString("base64url") },
      }),
      201,
      `register crowd tester ${t + 1}`,
    );
    const cycles = [cycleIds[t % CROWD_CYCLES], cycleIds[(t + 1) % CROWD_CYCLES]];
    for (const id of cycles) await expect(await call("POST", `/crowd/cycles/${id}/join`, { json: { acceptRules: true } }), 200, "join cycle");
    testers[t] = { call, cycles };
  });
  await inBatches([...Array(CROWD_REPORTS).keys()], 10, async (r) => {
    const tester = testers[r % CROWD_TESTERS];
    const cycleId = tester.cycles[Math.floor(r / CROWD_TESTERS) % 2];
    const report = await expect(
      await tester.call("POST", `/crowd/cycles/${cycleId}/reports`, {
        json: {
          title: `Perf report ${String(r + 1).padStart(4, "0")}`,
          steps: "1. Buka halaman\n2. Klik tombol",
          expected: "Berhasil",
          actual: "Gagal",
          environment: "Chrome 130",
          suggestedSeverity: SEVERITIES[r % SEVERITIES.length],
        },
      }),
      201,
      `seed crowd report ${r + 1}`,
    );
    await expect(
      await api("POST", `/projects/${slug}/crowd-reports/${report.number}/triage`, { json: { version: report.version, decision: "accept" } }),
      200,
      `accept crowd report ${r + 1}`,
    );
  });
  return cycleIds;
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
const manualRunNumber = await seedManual(readSlug, `0.${SEED_RUNS}.0`);

const crowdSlug = await createProject(`Perf crowd ${suffix}`, "public");
const crowdCycleIds = await seedCrowd(crowdSlug);

const ingestSlug = await createProject(`Perf ingest ${suffix}`, "private");
const ingestTokens = [];
for (let i = 0; i < INGEST_TOKENS; i += 1) ingestTokens.push(await createToken(ingestSlug, `perf ingest ${i + 1}`));

mkdirSync(dirname(STATE_FILE), { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify({ readSlug, manualRunNumber, crowdCycleIds, ingestSlug, ingestTokens }), { mode: 0o600 });
console.log(`perf setup done: read project "${readSlug}" with ${SEED_RUNS} versioned runs and ${SEED_BUGS} bugs (${linkedBugs} linked to failing tests), ${MANUAL_CASES} manual cases in ${MANUAL_SUITES} suites with one ${MANUAL_RUN_CASES}-case run (TR-${manualRunNumber}, ${MANUAL_EXECUTED} executed), crowd project "${crowdSlug}" with ${CROWD_CYCLES} cycles, ${CROWD_TESTERS} testers and ${CROWD_REPORTS} accepted reports, ingest project "${ingestSlug}" with ${INGEST_TOKENS} tokens`);
console.log(`state written to ${STATE_FILE}`);
