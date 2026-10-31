// k6 scenario "ingest": 5 VUs x 30 s uploading a ~500-testcase JUnit report with a Bearer token.
//   k6 run /scripts/ingest.js -e BASE_URL=http://web:8080
// Needs tests/perf/.state/state.json (see setup.mjs). VUs use the tokens round-robin so no token reaches the
// per-token upload limit; a 429 would count as a failed request.
import http from "k6/http";
import { check } from "k6";

const state = JSON.parse(open(__ENV.STATE_FILE || "./.state/state.json"));
const report = open("./fixtures/report-500.xml");
const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";

export const options = {
  scenarios: {
    ingest: { executor: "constant-vus", vus: 5, duration: "30s" },
  },
  thresholds: {
    "http_req_duration{scenario:ingest}": ["p(95)<1500"],
    // Fail closed: a tag-filtered threshold with no samples (e.g. scenario overridden by CLI flags) would pass vacuously.
    "http_reqs{scenario:ingest}": ["count>0"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  const token = state.ingestTokens[(__VU - 1) % state.ingestTokens.length];
  const commit = (__VU * 100000 + __ITER).toString(16).padStart(8, "0");
  const res = http.post(`${BASE_URL}/api/v1/projects/${state.ingestSlug}/runs?branch=main&commit=${commit}&name=k6`, report, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
    tags: { name: "POST runs" },
  });
  check(res, { "upload returns 201": (r) => r.status === 201 });
}
