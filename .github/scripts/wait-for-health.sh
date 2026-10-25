#!/usr/bin/env bash
# Polls <health-url> until it answers 200 with {"status":"ok","commit":"<expected-commit>"}.
#
# Used by deploy.yml: Render keeps serving the previous instance until the new one is healthy, so a bare 200 does not
# prove the new revision is live. The API reports the commit it runs (RENDER_GIT_COMMIT) in /api/health.
#
# Usage: wait-for-health.sh <health-url> <expected-commit> [timeout-seconds=600] [interval-seconds=15]
set -u

url="${1:?usage: wait-for-health.sh <health-url> <expected-commit> [timeout-seconds] [interval-seconds]}"
expected="${2:?expected commit is required}"
timeout="${3:-600}"
interval="${4:-15}"

# Prints the commit from a health body when status is "ok"; prints nothing otherwise (including invalid JSON).
extract_commit() {
  node -e '
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk)).on("end", () => {
      try {
        const body = JSON.parse(data);
        if (body.status === "ok" && typeof body.commit === "string") process.stdout.write(body.commit);
      } catch {
        // not JSON: treated as "no commit yet"
      }
    });
  '
}

deadline=$((SECONDS + timeout))
seen="no healthy response yet"
while true; do
  body="$(curl -fsS --max-time 20 "$url" 2>/dev/null)" || body=""
  commit="$(printf '%s' "$body" | extract_commit)"
  if [ "$commit" = "$expected" ]; then
    echo "Healthy and running ${expected}"
    exit 0
  fi
  if [ -n "$commit" ]; then
    seen="healthy but still running ${commit}"
  elif [ -n "$body" ]; then
    seen="answered without a commit (old API revision or unhealthy)"
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::${url} did not report commit ${expected} within ${timeout} s (last seen: ${seen})"
    exit 1
  fi
  echo "Not on ${expected} yet (${seen}); retrying in ${interval} s"
  sleep "$interval"
done
