#!/usr/bin/env node
// Writes the /mutation/ landing page of the GitHub Pages site (spec Tahap 4 §9).
//
//   node mutation-index.mjs <dir>                 index.html linking <dir>/api/ and <dir>/shared/ with their scores,
//                                                 read from each mutation.json; the scores also go to $GITHUB_STEP_SUMMARY.
//   node mutation-index.mjs --placeholder <dir>   index.html saying no report is available yet (ci.yml, when there is
//                                                 no successful mutation.yml run or its artifact cannot be downloaded).
//
// No dependencies: it runs in jobs that only have Node.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = [
  { dir: "api", name: "@testpulse/api", scope: "kode domain apps/api" },
  { dir: "shared", name: "@testpulse/shared", scope: "logika packages/shared" },
];

// Same formula as Stryker's "% Mutation score (total)": compile and runtime errors and ignored mutants do not count.
const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/** Mutation score in percent (two decimals) from a mutation-testing-report-schema JSON, or null when unreadable. */
function scoreOf(report) {
  let detected = 0;
  let undetected = 0;
  for (const file of Object.values(report?.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (DETECTED.has(mutant.status)) detected += 1;
      else if (UNDETECTED.has(mutant.status)) undetected += 1;
    }
  }
  const valid = detected + undetected;
  return valid === 0 ? null : Math.round((detected / valid) * 10000) / 100;
}

function readScore(path) {
  try {
    return scoreOf(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function page(body) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laporan mutation testing - TestPulse</title>
</head>
<body>
<h1>Laporan mutation testing</h1>
${body}
</body>
</html>
`;
}

function writePlaceholder(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    page("<p>Laporan mutation testing belum tersedia. Workflow <code>mutation.yml</code> belum pernah berhasil di branch main.</p>"),
  );
}

function writeIndex(dir) {
  mkdirSync(dir, { recursive: true });
  const rows = PACKAGES.map((p) => {
    const hasHtml = existsSync(join(dir, p.dir, "index.html"));
    const score = readScore(join(dir, p.dir, "mutation.json"));
    return { ...p, hasHtml, score };
  });
  const items = rows
    .map((r) => {
      const label = r.score === null ? "skor tidak tersedia" : `skor ${r.score.toFixed(2)}%`;
      const link = r.hasHtml ? `<a href="${r.dir}/">${r.name}</a>` : r.name;
      return `<li>${link} (${r.scope}): ${label}</li>`;
    })
    .join("\n");
  writeFileSync(
    join(dir, "index.html"),
    page(`<p>StrykerJS, gate skor minimal 80%.</p>\n<ul>\n${items}\n</ul>`),
  );

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const lines = rows.map((r) => `| ${r.name} | ${r.score === null ? "n/a" : `${r.score.toFixed(2)}%`} |`);
    appendFileSync(summary, ["### Mutation score", "", "| Package | Score |", "|---|---|", ...lines, ""].join("\n"));
  }
  for (const r of rows) console.log(`${r.name}: ${r.score === null ? "n/a" : `${r.score.toFixed(2)}%`}`);
}

const args = process.argv.slice(2);
if (args[0] === "--placeholder" && args[1]) writePlaceholder(args[1]);
else if (args[0] && !args[0].startsWith("--")) writeIndex(args[0]);
else {
  console.error("usage: mutation-index.mjs <dir> | --placeholder <dir>");
  process.exit(2);
}
