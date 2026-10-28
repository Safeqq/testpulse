export interface JUnitCase {
  suite?: string;
  name: string;
  status?: "passed" | "failed" | "skipped";
  /**
   * Jumlah percobaan ulang. Untuk `passed`, itu kemunculan gagal sebelum yang lulus (test flaky);
   * untuk `failed`, itu kemunculan gagal tambahan (gagal terus). Diabaikan untuk `skipped`.
   */
  retries?: number;
  message?: string;
  timeSec?: number;
}

/**
 * Escape untuk teks dan nilai atribut XML. Tab, newline, dan carriage return dikodekan sebagai referensi karakter
 * karena parser menormalkan spasi putih mentah di dalam atribut menjadi spasi; pesan multi-baris baru utuh bila dikodekan.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

function failure(message: string): string {
  return `<failure message="${escapeXml(message)}">${escapeXml(message)}</failure>`;
}

function testcase(suite: string, c: JUnitCase, outcome: "passed" | "failed" | "skipped"): string {
  const attrs = `classname="${escapeXml(suite)}" name="${escapeXml(c.name)}" time="${c.timeSec ?? 0.1}"`;
  const message = c.message ?? "Assertion gagal";
  if (outcome === "failed") return `<testcase ${attrs}>${failure(message)}</testcase>`;
  if (outcome === "skipped") return `<testcase ${attrs}><skipped/></testcase>`;
  return `<testcase ${attrs}/>`;
}

/**
 * Membangun JUnit XML sederhana; test `passed` dengan `retries` n memuat n kemunculan gagal sebelum yang lulus.
 * Pengelompokan test oleh API memakai pasangan (`classname`, `name`) tiap `<testcase>`, jadi `suite` ditulis sebagai
 * `classname`; kemunculan berulang dengan pasangan yang sama digabung menjadi satu hasil (dan menentukan flaky).
 */
export function buildJUnit(cases: JUnitCase[]): string {
  const rendered = cases.flatMap((c) => {
    const suite = c.suite ?? "suite";
    const status = c.status ?? "passed";
    const retries = c.retries ?? 0;
    if (status === "skipped") return [testcase(suite, c, "skipped")];
    const failedBefore = Array.from({ length: retries }, () => testcase(suite, c, "failed"));
    return [...failedBefore, testcase(suite, c, status)];
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="suite">${rendered.join("")}</testsuite></testsuites>`;
}
