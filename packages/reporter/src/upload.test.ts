import { describe, expect, it } from "vitest";
import type { ReporterOptions } from "./args.js";
import { UploadError, uploadReport } from "./upload.js";

const TOKEN = "tp_" + "B".repeat(43);
const OPTS: ReporterOptions = {
  url: "https://pulse.example.com",
  project: "testpulse",
  branch: "feat/x y",
  commit: "abc1234",
  ciUrl: "https://ci.example.com/run/1?a=b",
  name: "unit tests",
  files: ["a.xml"],
  token: TOKEN,
};
const XML = "<testsuites/>";
const RESULT = {
  runId: "r1",
  url: "https://pulse.example.com/p/testpulse/runs/r1",
  totals: { total: 3, passed: 2, failed: 1, skipped: 0, flaky: 0 },
};

interface Captured {
  url: URL;
  init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response>, calls: Captured[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(input instanceof Request ? input.url : input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("uploadReport", () => {
  it("POST ke endpoint project dengan Bearer, Content-Type XML, dan query yang di-encode", async () => {
    const calls: Captured[] = [];
    const result = await uploadReport(OPTS, XML, fakeFetch(() => json(201, RESULT), calls));
    expect(result).toEqual(RESULT);

    const { url, init } = calls[0]!;
    expect(url.origin).toBe("https://pulse.example.com");
    expect(url.pathname).toBe("/api/v1/projects/testpulse/runs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      branch: "feat/x y",
      commit: "abc1234",
      ciUrl: "https://ci.example.com/run/1?a=b",
      name: "unit tests",
    });
    expect(init.method).toBe("POST");
    expect(init.body).toBe(XML);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("content-type")).toBe("application/xml");
    expect(init.redirect).toBe("manual");
    // Token tidak boleh ikut ke URL.
    expect(url.href).not.toContain(TOKEN);
  });

  it("menghilangkan parameter opsional yang tidak diberikan dan menjaga path dasar", async () => {
    const calls: Captured[] = [];
    const minimal: ReporterOptions = {
      url: "https://host.example.com/pulse",
      project: "a b",
      branch: "main",
      files: ["a.xml"],
      token: TOKEN,
    };
    await uploadReport(minimal, XML, fakeFetch(() => json(201, RESULT), calls));
    const { url } = calls[0]!;
    expect(url.pathname).toBe("/pulse/api/v1/projects/a%20b/runs");
    expect([...url.searchParams.keys()]).toEqual(["branch"]);
  });

  it("error API menjadi UploadError dengan status dan kode", async () => {
    const body = { error: { code: "INVALID_REPORT", message: "Laporan tidak memuat testcase" } };
    const err = await uploadReport(OPTS, XML, fakeFetch(() => json(422, body))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ status: 422, code: "INVALID_REPORT", message: "Laporan tidak memuat testcase" });
  });

  it("respons error non-JSON (mis. gateway) tetap UploadError dengan status", async () => {
    const err = await uploadReport(
      OPTS,
      XML,
      fakeFetch(() => new Response("<html>Bad Gateway</html>", { status: 502 })),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ status: 502, code: null });
    expect((err as UploadError).message).toContain("502");
    expect((err as UploadError).message).not.toContain("Bad Gateway");
  });

  it("pengalihan (3xx) dilaporkan sebagai kegagalan dengan petunjuk, tidak diikuti", async () => {
    const err = await uploadReport(
      OPTS,
      XML,
      fakeFetch(() => new Response(null, { status: 301, headers: { location: "https://other.example.com/" } })),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 301, code: null });
    expect((err as UploadError).message).toContain("--url");
  });

  it("kegagalan jaringan menjadi UploadError tanpa status dan tanpa token", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const err = await uploadReport(
      OPTS,
      XML,
      fakeFetch(() => {
        throw new TypeError("fetch failed", { cause });
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ status: null, code: null });
    expect((err as UploadError).message).toContain("pulse.example.com");
    expect((err as UploadError).message).toContain("ECONNREFUSED");
    expect((err as UploadError).message).not.toContain(TOKEN);
  });

  it("respons 201 yang bentuknya salah ditolak", async () => {
    const err = await uploadReport(OPTS, XML, fakeFetch(() => json(201, { ok: true }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ status: 201 });
  });
});
