import { randomUUID } from "node:crypto";
import {
  compareDto,
  compareGroupPageDto,
  COMPARE_GROUPS,
  runDetailDto,
  runsPageDto,
  versionDto,
  type CompareDto,
} from "@testpulse/shared";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, parseBody } from "../support/http.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";

const API = "/api/v1";

/** v1.0.0 → v1.0.1: A regresi, B diperbaiki, C masih gagal, D lebih lambat (1,2 → 3,4 dtk), E baru, F hilang. */
const V100: JUnitCase[] = [
  { suite: "s", name: "A regresi" },
  { suite: "s", name: "B diperbaiki", status: "failed", message: "dulu gagal" },
  { suite: "s", name: "C masih gagal", status: "failed", message: "masih rusak" },
  { suite: "s", name: "D melambat", timeSec: 1.2 },
  { suite: "s", name: "F hilang" },
];
const V101: JUnitCase[] = [
  { suite: "s", name: "A regresi", status: "failed", message: "sekarang rusak" },
  { suite: "s", name: "B diperbaiki" },
  { suite: "s", name: "C masih gagal", status: "failed", message: "masih rusak" },
  { suite: "s", name: "D melambat", timeSec: 3.4 },
  { suite: "s", name: "E baru" },
];

interface Seed {
  owner: TestUser;
  slug: string;
  base: string;
  token: string;
  run100: string;
  run101: string;
}

async function upload(
  api: TestApi,
  token: string,
  slug: string,
  cases: JUnitCase[],
  query: { version?: string; branch?: string } = {},
): Promise<string> {
  const res = await api.uploadRun(token, slug, buildJUnit(cases), {
    branch: query.branch ?? "main",
    ...(query.version !== undefined ? { version: query.version } : {}),
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

async function seed(api: TestApi): Promise<Seed> {
  const owner = await api.register();
  const { slug } = await api.createProject(owner);
  const { token } = await api.createToken(owner, slug);
  const run100 = await upload(api, token, slug, V100, { version: "1.0.0" });
  const run101 = await upload(api, token, slug, V101, { version: "1.0.1" });
  return { owner, slug, base: `${API}/projects/${slug}`, token, run100, run101 };
}

const names = (page: { items: Array<{ name: string }> }) => page.items.map((item) => item.name);

test.describe("Upload dengan version lewat proxy", () => {
  test("version tersimpan di run: tampil di detail run dan daftar run, dapat difilter", async ({ api }) => {
    const { owner, base, run100, run101 } = await seed(api);

    const detail = await parseBody(await owner.request.get(`${base}/runs/${run101}`), 200, runDetailDto);
    expect(detail.run.version).toBe("1.0.1");
    const all = await parseBody(await owner.request.get(`${base}/runs`), 200, runsPageDto);
    expect(all.runs.map((r) => [r.id, r.version])).toEqual([
      [run101, "1.0.1"],
      [run100, "1.0.0"],
    ]);
    const filtered = await parseBody(await owner.request.get(`${base}/runs?version=1.0.0`), 200, runsPageDto);
    expect(filtered.runs.map((r) => r.id)).toEqual([run100]);
  });

  test("run tanpa version tetap diterima (version null)", async ({ api }) => {
    const { owner, slug, base, token } = await seed(api);
    const runId = await upload(api, token, slug, [{ name: "a" }]);
    const detail = await parseBody(await owner.request.get(`${base}/runs/${runId}`), 200, runDetailDto);
    expect(detail.run.version).toBeNull();
  });

  for (const version of ["a b", "v1/2", "x".repeat(51), "versi!"]) {
    test(`version tidak valid "${version.slice(0, 12)}…" → 400 pada field version dan tidak ada run baru`, async ({ api }) => {
      const { owner, slug, base, token } = await seed(api);
      const res = await api.uploadRun(token, slug, buildJUnit([{ name: "a" }]), { branch: "main", version });
      const error = await expectApiError(res, 400, "VALIDATION_ERROR");
      expect(error.fields?.["version"]).toEqual(expect.any(String));
      const runs = await parseBody(await owner.request.get(`${base}/runs`), 200, runsPageDto);
      expect(runs.runs).toHaveLength(2);
    });
  }
});

test.describe("GET /versions lewat proxy", () => {
  test("versi tertinggi dulu dengan pass rate dan selisih terhadap versi di bawahnya", async ({ api }) => {
    const { owner, base, run100, run101 } = await seed(api);
    const versions = await parseBody(await owner.request.get(`${base}/versions`), 200, versionDto.array());

    expect(versions.map((v) => v.version)).toEqual(["1.0.1", "1.0.0"]);
    expect(versions.map((v) => v.run.id)).toEqual([run101, run100]);
    expect(versions.map((v) => v.runCount)).toEqual([1, 1]);
    // v1.0.0: 3 lulus dari 5 → 60%; v1.0.1: 3 dari 5 → 60%.
    expect(versions[1]).toMatchObject({ passRate: 60, passRateDelta: null });
    expect(versions[0]).toMatchObject({ passRate: 60, passRateDelta: 0 });
  });

  test("versi yang sama menurut semver (v1.0.1 dan 1.0.1) menjadi satu entri dengan runCount 2", async ({ api }) => {
    const { owner, slug, base, token } = await seed(api);
    await upload(api, token, slug, V101, { version: "v1.0.1" });
    const versions = await parseBody(await owner.request.get(`${base}/versions`), 200, versionDto.array());
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ runCount: 2 });
  });

  test("project kosong atau branch tanpa run → daftar versi kosong, bukan error", async ({ api }) => {
    const owner = await api.register();
    const { slug } = await api.createProject(owner);
    const empty = await parseBody(await owner.request.get(`${API}/projects/${slug}/versions`), 200, versionDto.array());
    expect(empty).toEqual([]);
    const seeded = await seed(api);
    const other = await parseBody(await seeded.owner.request.get(`${seeded.base}/versions?branch=tidak-ada`), 200, versionDto.array());
    expect(other).toEqual([]);
  });
});

test.describe("GET /compare lewat proxy", () => {
  test("pembanding default: target = run terbaru, base = versi sebelumnya; enam kelompok sesuai schema", async ({ api }) => {
    const { owner, base, run100, run101 } = await seed(api);
    const compare = await parseBody(await owner.request.get(`${base}/compare`), 200, compareDto);

    expect(compare.base?.id).toBe(run100);
    expect(compare.target?.id).toBe(run101);
    expect(compare.summary).toEqual({ regressions: 1, fixed: 1, stillFailing: 1, slower: 1, added: 1, removed: 1 });
    expect(names(compare.groups.regressions)).toEqual(["A regresi"]);
    expect(names(compare.groups.fixed)).toEqual(["B diperbaiki"]);
    expect(names(compare.groups.stillFailing)).toEqual(["C masih gagal"]);
    expect(names(compare.groups.slower)).toEqual(["D melambat"]);
    expect(names(compare.groups.added)).toEqual(["E baru"]);
    expect(names(compare.groups.removed)).toEqual(["F hilang"]);
    for (const group of COMPARE_GROUPS) expect(compare.groups[group].nextCursor).toBeNull();

    const regression = compare.groups.regressions.items[0]!;
    expect(regression.base).toMatchObject({ status: "passed", message: null });
    expect(regression.target).toMatchObject({ status: "failed", message: "sekarang rusak" });
    expect(compare.groups.added.items[0]).toMatchObject({ base: null, target: { status: "passed" } });
    expect(compare.groups.removed.items[0]).toMatchObject({ base: { status: "passed" }, target: null });
  });

  test("base dan target eksplisit; base boleh dari urutan terbalik", async ({ api }) => {
    const { owner, base, run100, run101 } = await seed(api);
    const reversed = await parseBody(await owner.request.get(`${base}/compare?base=${run101}&target=${run100}`), 200, compareDto);
    expect(reversed.base?.id).toBe(run101);
    expect(reversed.target?.id).toBe(run100);
    // Arah dibalik: A kini diperbaiki, B kini regresi.
    expect(names(reversed.groups.regressions)).toEqual(["B diperbaiki"]);
    expect(names(reversed.groups.fixed)).toEqual(["A regresi"]);
  });

  test("groups=none: hanya ringkasan angka, semua kelompok kosong (Ruling T10-d)", async ({ api }) => {
    const { owner, base, run100, run101 } = await seed(api);
    const full = await parseBody(await owner.request.get(`${base}/compare`), 200, compareDto);
    const summary = await parseBody(await owner.request.get(`${base}/compare?groups=none`), 200, compareDto);

    expect(summary.base?.id).toBe(run100);
    expect(summary.target?.id).toBe(run101);
    expect(summary.summary).toEqual(full.summary);
    for (const group of COMPARE_GROUPS) expect(summary.groups[group]).toEqual({ items: [], nextCursor: null });
  });

  test("project tanpa run atau run tunggal: base/target null, ringkasan nol (200)", async ({ api }) => {
    const owner = await api.register();
    const { slug } = await api.createProject(owner);
    const empty = await parseBody(await owner.request.get(`${API}/projects/${slug}/compare`), 200, compareDto);
    expect(empty).toMatchObject({ base: null, target: null, summary: { regressions: 0, fixed: 0, stillFailing: 0, slower: 0, added: 0, removed: 0 } });

    const { token } = await api.createToken(owner, slug);
    const only = await upload(api, token, slug, [{ name: "a" }], { version: "1.0.0" });
    const single = await parseBody(await owner.request.get(`${API}/projects/${slug}/compare`), 200, compareDto);
    expect(single.target?.id).toBe(only);
    expect(single.base).toBeNull();
  });

  test("badge bug pada item perbandingan: bug aktif tertaut ke test muncul di baris regresi", async ({ api }) => {
    const { owner, slug, base, run101 } = await seed(api);
    const detail = await parseBody(await owner.request.get(`${base}/runs/${run101}?status=all`), 200, runDetailDto);
    const testCaseId = detail.results.find((r) => r.name === "A regresi")!.testCaseId;
    const bug = await api.createBug(owner, slug, { title: "Regresi A", testCaseId, runId: run101 });

    const compare = await parseBody(await owner.request.get(`${base}/compare`), 200, compareDto);
    expect(compare.groups.regressions.items[0]!.bugs).toEqual([{ number: bug.number, title: "Regresi A", status: "open" }]);
    // Bug yang sudah ditutup tidak lagi menjadi badge.
    await api.updateBug(owner, slug, bug.number, { version: 1, status: "closed", resolution: "wont_fix" });
    const closed = await parseBody(await owner.request.get(`${base}/compare`), 200, compareDto);
    expect(closed.groups.regressions.items[0]!.bugs).toEqual([]);
  });

  test("id run tidak dikenal → 404 RUN_NOT_FOUND; base sama dengan target → 400; id bukan UUID → 404", async ({ api }) => {
    const { owner, base, run100 } = await seed(api);
    await expectApiError(await owner.request.get(`${base}/compare?target=${randomUUID()}`), 404, "RUN_NOT_FOUND");
    await expectApiError(await owner.request.get(`${base}/compare?base=${randomUUID()}`), 404, "RUN_NOT_FOUND");
    await expectApiError(await owner.request.get(`${base}/compare?base=bukan-uuid`), 404, "RUN_NOT_FOUND");
    const same = await expectApiError(await owner.request.get(`${base}/compare?base=${run100}&target=${run100}`), 400, "VALIDATION_ERROR");
    expect(same.fields?.["base"]).toEqual(expect.any(String));
  });

  test("parameter tidak valid → 400: cursor tanpa group, groups=none bersama group, group tidak dikenal", async ({ api }) => {
    const { owner, base } = await seed(api);
    await expectApiError(await owner.request.get(`${base}/compare?cursor=abc`), 400, "VALIDATION_ERROR");
    await expectApiError(await owner.request.get(`${base}/compare?groups=none&group=fixed`), 400, "VALIDATION_ERROR");
    await expectApiError(await owner.request.get(`${base}/compare?group=bukan`), 400, "VALIDATION_ERROR");
    await expectApiError(await owner.request.get(`${base}/compare?group=fixed&cursor=bukan-cursor`), 400, "VALIDATION_ERROR");
  });

  test("paginasi kelompok: 200 item pertama, sisanya 100 per halaman lewat cursor yang terikat pasangan run", async ({ api }) => {
    const owner = await api.register();
    const { slug } = await api.createProject(owner);
    const { token } = await api.createToken(owner, slug);
    const base = `${API}/projects/${slug}`;
    const total = 250;
    const pad = (i: number) => String(i).padStart(3, "0");
    const passing = Array.from({ length: total }, (_, i): JUnitCase => ({ suite: "s", name: `t${pad(i)}` }));
    const failing = passing.map((c): JUnitCase => ({ ...c, status: "failed", message: "rusak" }));
    const run1 = await upload(api, token, slug, passing, { version: "1.0.0" });
    const run2 = await upload(api, token, slug, failing, { version: "1.0.1" });

    const first = await parseBody(await owner.request.get(`${base}/compare`), 200, compareDto);
    expect(first.summary.regressions).toBe(total);
    expect(first.groups.regressions.items).toHaveLength(200);
    const cursor = first.groups.regressions.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    expect(first.groups.regressions.items[0]!.name).toBe("t000");

    const second = await parseBody(
      await owner.request.get(`${base}/compare?group=regressions&cursor=${encodeURIComponent(cursor!)}`),
      200,
      compareGroupPageDto,
    );
    expect(second.items).toHaveLength(50);
    expect(second.items[0]!.name).toBe("t200");
    expect(second.nextCursor).toBeNull();

    // `group` tanpa cursor = 100 item pertama kelompok itu (Ruling T6-a).
    const head = await parseBody(await owner.request.get(`${base}/compare?group=regressions`), 200, compareGroupPageDto);
    expect(head.items).toHaveLength(100);
    expect(head.nextCursor).toEqual(expect.any(String));

    // Cursor terikat pada pasangan (base, target): dipakai untuk pasangan lain → 400 pada field cursor (Ruling T6-b).
    const stale = await owner.request.get(
      `${base}/compare?base=${run2}&target=${run1}&group=regressions&cursor=${encodeURIComponent(cursor!)}`,
    );
    const error = await expectApiError(stale, 400, "VALIDATION_ERROR");
    expect(error.fields?.["cursor"]).toEqual(expect.any(String));

    // Pasangan sama dengan cursor yang valid tetap berhasil bila diberikan eksplisit.
    const explicit = await parseBody(
      await owner.request.get(`${base}/compare?base=${run1}&target=${run2}&group=regressions&cursor=${encodeURIComponent(cursor!)}`),
      200,
      compareGroupPageDto,
    );
    expect(explicit.items).toHaveLength(50);
  });
});

test.describe("Baca versi dan perbandingan: akses", () => {
  test("project publik: anonim membaca versi dan perbandingan; project privat → 404 PROJECT_NOT_FOUND", async ({ api }) => {
    const { owner, slug, base } = await seed(api);
    const anon = await api.anonymous();
    await expectApiError(await anon.get(`${base}/compare`), 404, "PROJECT_NOT_FOUND");
    await expectApiError(await anon.get(`${base}/versions`), 404, "PROJECT_NOT_FOUND");

    await api.setVisibility(owner, slug, "public");
    const compare: CompareDto = await parseBody(await anon.get(`${base}/compare`), 200, compareDto);
    expect(compare.summary.regressions).toBe(1);
    expect(await parseBody(await anon.get(`${base}/versions`), 200, versionDto.array())).toHaveLength(2);
  });
});
