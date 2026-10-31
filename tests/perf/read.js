// k6 scenario "read": 10 VUs x 30 s reading stats, runs and flaky of a public project holding >= 50 runs.
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

const ENDPOINTS = ["stats", "runs", "flaky"];

export default function () {
  for (const endpoint of ENDPOINTS) {
    const res = http.get(`${BASE_URL}/api/v1/projects/${state.readSlug}/${endpoint}`, { tags: { name: `GET ${endpoint}` } });
    check(res, { [`${endpoint} returns 200`]: (r) => r.status === 200 });
  }
}
