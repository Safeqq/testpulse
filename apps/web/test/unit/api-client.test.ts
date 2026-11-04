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

describe("klien API: bug", () => {
  it("list tanpa filter tidak menambahkan query string", async () => {
    const { api, fetchFn } = client(200, { bugs: [], nextCursor: null });
    await api.bugs.list("proyek-a");
    expect(lastCall(fetchFn)).toMatchObject({ url: "/api/v1/projects/proyek-a/bugs", method: "GET" });
    await api.bugs.list("proyek-a", { status: undefined, q: "", label: "" });
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/bugs");
  });

  it("list meng-encode filter dan membuang yang kosong", async () => {
    const { api, fetchFn } = client(200, { bugs: [], nextCursor: null });
    await api.bugs.list("proyek-a", { status: "done", assignee: "me", priority: "high", q: "a&b c", sort: "priority", cursor: "x+/=" });
    expect(lastCall(fetchFn).url).toBe(
      "/api/v1/projects/proyek-a/bugs?status=done&assignee=me&priority=high&q=a%26b+c&sort=priority&cursor=x%2B%2F%3D",
    );
  });

  it("labels, get, activity memakai GET dan meng-encode segmen path", async () => {
    const { api, fetchFn } = client();
    await api.bugs.labels("a/b");
    expect(lastCall(fetchFn)).toMatchObject({ url: "/api/v1/projects/a%2Fb/bugs/labels", method: "GET" });
    await api.bugs.get("proyek-a", 12);
    expect(lastCall(fetchFn)).toMatchObject({ url: "/api/v1/projects/proyek-a/bugs/12", method: "GET" });
    await api.bugs.activity("proyek-a", 12);
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/bugs/12/activity");
    await api.bugs.activity("proyek-a", 12, "c+1");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/bugs/12/activity?cursor=c%2B1");
  });

  it("create, update, remove memakai POST/PATCH/DELETE", async () => {
    const { api, fetchFn } = client(200, {});
    await api.bugs.create("proyek-a", { title: "Judul" });
    expect(lastCall(fetchFn)).toMatchObject({
      url: "/api/v1/projects/proyek-a/bugs",
      method: "POST",
      body: JSON.stringify({ title: "Judul" }),
    });
    await api.bugs.update("proyek-a", 3, { version: 2, status: "resolved" });
    expect(lastCall(fetchFn)).toMatchObject({
      url: "/api/v1/projects/proyek-a/bugs/3",
      method: "PATCH",
      body: JSON.stringify({ version: 2, status: "resolved" }),
    });
    const removed = client(204);
    await removed.api.bugs.remove("proyek-a", 3);
    expect(lastCall(removed.fetchFn)).toMatchObject({ url: "/api/v1/projects/proyek-a/bugs/3", method: "DELETE" });
  });
});

describe("klien API: komentar bug", () => {
  it("create, update, remove memakai path komentar", async () => {
    const { api, fetchFn } = client(200, {});
    await api.comments.create("proyek-a", 3, { body: "Halo" });
    expect(lastCall(fetchFn)).toMatchObject({
      url: "/api/v1/projects/proyek-a/bugs/3/comments",
      method: "POST",
      body: JSON.stringify({ body: "Halo" }),
    });
    await api.comments.update("proyek-a", 3, "c-1", { body: "Ubah" });
    expect(lastCall(fetchFn)).toMatchObject({
      url: "/api/v1/projects/proyek-a/bugs/3/comments/c-1",
      method: "PATCH",
      body: JSON.stringify({ body: "Ubah" }),
    });
    const removed = client(204);
    await removed.api.comments.remove("proyek-a", 3, "c-1");
    expect(lastCall(removed.fetchFn)).toMatchObject({
      url: "/api/v1/projects/proyek-a/bugs/3/comments/c-1",
      method: "DELETE",
    });
  });
});

describe("klien API: versi dan perbandingan", () => {
  it("versions membuang branch kosong dan meng-encode yang ada", async () => {
    const { api, fetchFn } = client(200, []);
    await api.results.versions("proyek-a");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/versions");
    await api.results.versions("proyek-a", "");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/versions");
    await api.results.versions("proyek-a", "release/1.0");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/versions?branch=release%2F1.0");
  });

  it("compare tanpa parameter atau dengan parameter kosong tidak menambahkan query string", async () => {
    const { api, fetchFn } = client();
    await api.results.compare("proyek-a");
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/compare");
    await api.results.compare("proyek-a", { base: "", target: undefined, branch: "" });
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/compare");
  });

  it("compare mengirim base, target, dan branch", async () => {
    const { api, fetchFn } = client();
    await api.results.compare("proyek-a", { base: "r1", target: "r2", branch: "feature/x" });
    expect(lastCall(fetchFn).url).toBe("/api/v1/projects/proyek-a/compare?base=r1&target=r2&branch=feature%2Fx");
  });

  it("compareGroup mengirim kelompok, cursor, dan id base/target dari respons pertama", async () => {
    const { api, fetchFn } = client();
    await api.results.compareGroup("proyek-a", { base: "r1", target: "r2", group: "stillFailing", cursor: "c+1" });
    expect(lastCall(fetchFn)).toMatchObject({
      url: "/api/v1/projects/proyek-a/compare?base=r1&target=r2&group=stillFailing&cursor=c%2B1",
      method: "GET",
    });
  });
});
