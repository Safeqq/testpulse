import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../src/lib/api";

function client(status = 200, body: unknown = {}) {
  const fetchFn = vi.fn<typeof fetch>(async () =>
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status }),
  );
  return { api: createApiClient("/api", fetchFn), fetchFn };
}

function lastCall(fetchFn: ReturnType<typeof client>["fetchFn"]) {
  const [url, init] = fetchFn.mock.calls.at(-1) ?? [];
  return { url: String(url), method: init?.method, body: init?.body };
}

describe("klien API: hasil test", () => {
  it("branches memakai path project", async () => {
    const { api, fetchFn } = client(200, []);
    await api.results.branches("proyek-a");
    expect(lastCall(fetchFn)).toMatchObject({ url: "/api/v1/projects/proyek-a/branches", method: "GET" });
  });

  it("runs tanpa parameter tidak menambahkan query string", async () => {
    const { api, fetchFn } = client();
    await api.results.runs("proyek-a", {});
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/runs");
  });

  it("runs membuang branch/cursor kosong atau undefined (branch kosong ditolak server dengan 400)", async () => {
    const { api, fetchFn } = client();
    await api.results.runs("proyek-a", { branch: "", cursor: undefined });
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/runs");
  });

  it("runs meng-encode branch yang memuat garis miring dan cursor", async () => {
    const { api, fetchFn } = client();
    await api.results.runs("proyek-a", { branch: "feature/a b", cursor: "abc+/=" });
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/runs?branch=feature%2Fa+b&cursor=abc%2B%2F%3D");
  });

  it("run mengirim status dan cursor hasil hanya bila diberikan", async () => {
    const { api, fetchFn } = client();
    await api.results.run("proyek-a", "run-1");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/runs/run-1");
    await api.results.run("proyek-a", "run-1", { status: "flaky", cursor: "c1" });
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/runs/run-1?status=flaky&cursor=c1");
  });

  it("deleteRun memakai DELETE", async () => {
    const { api, fetchFn } = client(204);
    await api.results.deleteRun("proyek-a", "run-1");
    expect(lastCall(fetchFn)).toMatchObject({ url: "/api/v1/projects/proyek-a/runs/run-1", method: "DELETE" });
  });

  it("stats, flaky, dan history membuang branch kosong dan meng-encode yang ada", async () => {
    const { api, fetchFn } = client();
    await api.results.stats("proyek-a");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/stats");
    await api.results.stats("proyek-a", "");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/stats");
    await api.results.stats("proyek-a", "release/1.0");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/stats?branch=release%2F1.0");
    await api.results.flaky("proyek-a", "release/1.0");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/flaky?branch=release%2F1.0");
    await api.results.history("proyek-a", "t-1", "release/1.0");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/tests/t-1/history?branch=release%2F1.0");
    await api.results.history("proyek-a", "t-1");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/tests/t-1/history");
  });

  it("segmen path di-encode", async () => {
    const { api, fetchFn } = client();
    await api.results.run("a/b", "r/1");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/a%2Fb/runs/r%2F1");
  });
});

describe("klien API: token CI", () => {
  it("list memakai GET", async () => {
    const { api, fetchFn } = client(200, []);
    await api.tokens.list("proyek-a");
    expect(lastCall(fetchFn)).toMatchObject({ url: "/api/v1/projects/proyek-a/tokens", method: "GET" });
  });

  it("create mengirim nama sebagai JSON", async () => {
    const { api, fetchFn } = client(201, { id: "1", name: "CI", token: "tp_x", createdAt: "2026-10-28T00:00:00.000Z" });
    const created = await api.tokens.create("proyek-a", "CI");
    expect(lastCall(fetchFn)).toMatchObject({
      url: "/api/v1/projects/proyek-a/tokens",
      method: "POST",
      body: JSON.stringify({ name: "CI" }),
    });
    expect(created.token).toBe("tp_x");
  });

  it("revoke memakai DELETE pada id token", async () => {
    const { api, fetchFn } = client(204);
    await api.tokens.revoke("proyek-a", "tok-1");
    expect(lastCall(fetchFn)).toMatchObject({ url: "/api/v1/projects/proyek-a/tokens/tok-1", method: "DELETE" });
  });
});
