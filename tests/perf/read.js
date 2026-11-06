// k6 scenario "read": 10 VUs x 30 s reading a public project holding >= 50 versioned runs and >= 100 bugs:
// stats, runs, flaky (Tahap 2) and bugs, compare (default pair and summary-only), versions (Tahap 3).
//   k6 run /scripts/read.js -e BASE_URL=http://web:8080
// Needs tests/perf/.state/state.json (see setup.mjs). The read project is public, so no credentials are sent.
import http from "k6/http";
import { check } from "k6";

const state = JSON.parse(open(__ENV.STATE_FILE || "./.state/state.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";

export const options = {
  scenarios: {
    read: { executor: "constant-vus", vus: 10, duration: "30s" },
  },
  thresholds: {
    "http_req_duration{scenario:read}": ["p(95)<300"],
    // Fail closed: a tag-filtered threshold with no samples (e.g. scenario overridden by CLI flags) would pass vacuously.
    "http_reqs{scenario:read}": ["count>0"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

// `ok` inspects the parsed body so an empty or malformed answer fails the run, not only a non-200 status: the seeded
// project must really have >= 50 versions, a full first page of bugs and a default comparison with a baseline.
const ENDPOINTS = [
  { name: "stats", path: "stats" },
  { name: "runs", path: "runs" },
  { name: "flaky", path: "flaky" },
  { name: "bugs", path: "bugs", ok: (body) => body.bugs.length === 25 && body.nextCursor !== null },
  { name: "compare", path: "compare", ok: (body) => body.base !== null && body.target !== null && body.groups !== undefined },
  // The dashboard card and the run page panel use the summary-only mode (no groups, no message/bug queries).
  { name: "compare summary", path: "compare?groups=none", ok: (body) => body.base !== null && body.target !== null },
  { name: "versions", path: "versions", ok: (body) => body.length >= 50 },
];

export default function () {
  for (const { name, path, ok } of ENDPOINTS) {
    const res = http.get(`${BASE_URL}/api/v1/projects/${state.readSlug}/${path}`, { tags: { name: `GET ${name}` } });
    check(res, { [`${name} returns 200`]: (r) => r.status === 200 });
    if (ok) {
      check(res, {
        [`${name} returns the seeded data`]: (r) => {
          try {
            return ok(r.json());
          } catch {
            return false;
          }
        },
      });
    }
  }
}
