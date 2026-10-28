import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main, MAX_REPORT_BYTES, type ReporterIO } from "./cli.js";
import { mergeJUnit } from "./merge.js";

const TOKEN = "tp_" + "C".repeat(43);
const ENV = { TESTPULSE_TOKEN: TOKEN };
const RESULT = {
  runId: "run-1",
  url: "https://pulse.example.com/p/testpulse/runs/run-1",
  totals: { total: 4, passed: 2, failed: 1, skipped: 1, flaky: 0 },
};

const suiteDoc = (name: string, pad = "") =>
  `<testsuite name="${name}"${pad ? ` pad="${pad}"` : ""}><testcase classname="${name}" name="t"/></testsuite>`;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tp-reporter-"));
  await mkdir(path.join(dir, "reports"));
  await writeFile(path.join(dir, "reports", "one.xml"), `<testsuites>${suiteDoc("satu")}${suiteDoc("dua")}</testsuites>`);
  await writeFile(path.join(dir, "reports", "two.xml"), suiteDoc("tiga"));
  await writeFile(path.join(dir, "reports", "notes.txt"), "bukan laporan");
  await writeFile(path.join(dir, "single.xml"), suiteDoc("tunggal"));
  await writeFile(path.join(dir, "evil.xml"), `<!DOCTYPE testsuites [<!ENTITY x "y">]><testsuites>${suiteDoc("x")}</testsuites>`);
  await writeFile(path.join(dir, "broken.xml"), "<testsuites><testsuite></testsuites>");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Harness {
  io: ReporterIO;
  out: string[];
  err: string[];
  requests: { url: URL; init: RequestInit }[];
}

function harness(respond: () => Response | Promise<Response> = () => json(201, RESULT)): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const requests: Harness["requests"] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(input instanceof Request ? input.url : input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l), cwd: dir, fetch: fetchFn }, out, err, requests };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BASE = ["--url", "https://pulse.example.com", "--project", "testpulse", "--branch", "main"];
const run = (h: Harness, files: string[], extra: string[] = [], env: NodeJS.ProcessEnv = ENV) =>
  main([...BASE, ...extra, ...files], env, h.io);

/** Seluruh keluaran (stdout + stderr) tidak boleh memuat token, apa pun jalurnya. */
function expectNoToken(h: Harness): void {
  expect([...h.out, ...h.err].join("\n")).not.toContain(TOKEN);
}

describe("main: argumen", () => {
  it("argumen kurang -> exit 2, pesan Indonesia, tanpa upload, tanpa token di keluaran", async () => {
    const h = harness();
    const code = await main(["--project", "testpulse"], ENV, h.io);
    expect(code).toBe(2);
    expect(h.err.join("\n")).toContain("--url wajib diisi");
    expect(h.requests).toHaveLength(0);
    expectNoToken(h);
  });

  it("TESTPULSE_TOKEN tidak ada -> exit 2", async () => {
    const h = harness();
    expect(await run(h, ["single.xml"], [], {})).toBe(2);
    expect(h.err.join("\n")).toContain("TESTPULSE_TOKEN");
    expect(h.requests).toHaveLength(0);
  });

  it("token yang salah diketik sebagai flag tidak pernah dicetak", async () => {
    const h = harness();
    expect(await run(h, ["single.xml"], ["--token", TOKEN])).toBe(2);
    expectNoToken(h);
  });
});

describe("main: berkas", () => {
  it("glob mencocokkan beberapa file dan semuanya digabung dalam satu upload", async () => {
    const h = harness();
    expect(await run(h, ["reports/*.xml"])).toBe(0);
    expect(h.requests).toHaveLength(1);
    const body = String(h.requests[0]?.init.body);
    for (const name of ["satu", "dua", "tiga"]) expect(body).toContain(`name="${name}"`);
    expect(body).not.toContain("bukan laporan");
    expect(body.match(/<testsuites>/g)).toHaveLength(1);
    expectNoToken(h);
  });

  it("gabungan glob dan path literal; file yang sama tidak diunggah dua kali", async () => {
    const h = harness();
    expect(await run(h, ["reports/*.xml", "single.xml", "reports/one.xml"])).toBe(0);
    const body = String(h.requests[0]?.init.body);
    expect(body.match(/<testsuite name="satu"/g)).toHaveLength(1);
    expect(body).toContain('name="tunggal"');
  });

  it("glob tanpa hasil -> exit 2 dan menyebut pola", async () => {
    const h = harness();
    expect(await run(h, ["tidak-ada/*.xml"])).toBe(2);
    expect(h.err.join("\n")).toContain("tidak-ada/*.xml");
    expect(h.requests).toHaveLength(0);
  });

  it("file literal yang tidak ada -> exit 2", async () => {
    const h = harness();
    expect(await run(h, ["hilang.xml"])).toBe(2);
    expect(h.err.join("\n")).toContain("hilang.xml");
    expect(h.requests).toHaveLength(0);
  });

  it("<!DOCTYPE -> exit 2 tanpa upload, menyebut nama file", async () => {
    const h = harness();
    expect(await run(h, ["single.xml", "evil.xml"])).toBe(2);
    expect(h.err.join("\n")).toContain("evil.xml");
    expect(h.err.join("\n")).toContain("DOCTYPE");
    expect(h.requests).toHaveLength(0);
  });

  it("XML tidak valid -> exit 2 tanpa upload", async () => {
    const h = harness();
    expect(await run(h, ["broken.xml"])).toBe(2);
    expect(h.err.join("\n")).toContain("broken.xml");
    expect(h.requests).toHaveLength(0);
  });

  it("batas ukuran 5 MB berlaku pada dokumen hasil gabungan: tepat 5 MB lolos, 5 MB + 1 ditolak", async () => {
    const overhead = Buffer.byteLength(mergeJUnit([suiteDoc("besar", "")]));
    // Atribut `pad` menambah 7 byte (` pad=""`) di luar isinya.
    const padFor = (total: number) => "x".repeat(total - overhead - 7);

    await writeFile(path.join(dir, "exact.xml"), suiteDoc("besar", padFor(MAX_REPORT_BYTES)));
    const ok = harness();
    expect(await run(ok, ["exact.xml"])).toBe(0);
    expect(Buffer.byteLength(String(ok.requests[0]?.init.body))).toBe(MAX_REPORT_BYTES);

    await writeFile(path.join(dir, "over.xml"), suiteDoc("besar", padFor(MAX_REPORT_BYTES + 1)));
    const over = harness();
    expect(await run(over, ["over.xml"])).toBe(2);
    expect(over.err.join("\n")).toContain("5 MB");
    expect(over.requests).toHaveLength(0);
  });
});

describe("main: upload", () => {
  it("201 -> exit 0, mencetak total dan URL run, tanpa token", async () => {
    const h = harness();
    const code = await run(h, ["single.xml"], ["--commit", "abc1234", "--ci-url", "https://ci.example.com/1", "--name", "unit"]);
    expect(code).toBe(0);
    const out = h.out.join("\n");
    expect(out).toContain(RESULT.url);
    expect(out).toContain("4 test");
    expect(out).toContain("2 lulus");
    expect(out).toContain("1 gagal");
    expect(out).toContain("1 dilewati");
    expect(h.err).toEqual([]);
    expectNoToken(h);

    const { url, init } = h.requests[0]!;
    expect(url.pathname).toBe("/api/v1/projects/testpulse/runs");
    expect(url.searchParams.get("branch")).toBe("main");
    expect(url.searchParams.get("commit")).toBe("abc1234");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("422 -> exit 1 dan mencetak pesan API", async () => {
    const h = harness(() => json(422, { error: { code: "INVALID_REPORT", message: "Laporan tidak memuat testcase" } }));
    expect(await run(h, ["single.xml"])).toBe(1);
    const err = h.err.join("\n");
    expect(err).toContain("422");
    expect(err).toContain("INVALID_REPORT");
    expect(err).toContain("Laporan tidak memuat testcase");
    expect(h.out).toEqual([]);
    expectNoToken(h);
  });

  it("401 -> exit 1 tanpa token di keluaran, bahkan bila server memantulkannya", async () => {
    const h = harness(() => json(401, { error: { code: "UNAUTHENTICATED", message: `Token CI tidak valid: ${TOKEN}` } }));
    expect(await run(h, ["single.xml"])).toBe(1);
    expect(h.err.join("\n")).toContain("UNAUTHENTICATED");
    expectNoToken(h);
  });

  it("kegagalan jaringan -> exit 1 tanpa token", async () => {
    const h = harness(() => {
      throw new TypeError(`fetch failed (Authorization: Bearer ${TOKEN})`, { cause: { code: "ECONNREFUSED" } });
    });
    expect(await run(h, ["single.xml"])).toBe(1);
    expect(h.err.join("\n")).toContain("ECONNREFUSED");
    expectNoToken(h);
  });

  it("karakter kontrol dari server tidak diteruskan ke terminal", async () => {
    const h = harness(() => json(400, { error: { code: "VALIDATION_ERROR", message: "a\u001b[31mmerah\u0007\nbaris palsu" } }));
    expect(await run(h, ["single.xml"])).toBe(1);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).not.toContain("\n");
    expect(h.err.join("\n")).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
  });
});
