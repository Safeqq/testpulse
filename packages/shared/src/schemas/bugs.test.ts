import { describe, expect, it } from "vitest";
import {
  BUG_PRIORITIES,
  BUG_RESOLUTIONS,
  BUG_SEVERITIES,
  BUG_STATUSES,
  activityPageDto,
  bugDto,
  bugLabel,
  bugLink,
  bugListQuery,
  commentBody,
  createBugBody,
  updateBugBody,
} from "../index.js";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, input: unknown) =>
  schema.safeParse(input).success;

const UUID_A = "0b8f3c2e-6f0a-4c1d-9a63-0d6f4c1d2e3f";
const UUID_B = "1b8f3c2e-6f0a-4c1d-9a63-0d6f4c1d2e3f";

describe("enum bug", () => {
  it("nilainya sesuai spec §3", () => {
    expect(BUG_STATUSES).toEqual(["open", "in_progress", "resolved", "closed"]);
    expect(BUG_RESOLUTIONS).toEqual(["fixed", "wont_fix", "duplicate", "cannot_reproduce"]);
    expect(BUG_PRIORITIES).toEqual(["low", "medium", "high", "urgent"]);
    expect(BUG_SEVERITIES).toEqual(["minor", "major", "critical", "blocker"]);
  });
});

describe("bugLabel", () => {
  it("men-trim dan menjadikan huruf kecil", () => expect(bugLabel.parse(" UI ")).toBe("ui"));
  it("menerima 1 dan 30 karakter [a-z0-9-]", () => {
    expect(ok(bugLabel, "a")).toBe(true);
    expect(ok(bugLabel, "a-1".padEnd(30, "b"))).toBe(true);
  });
  it.each([
    ["garis bawah", "ui_x"],
    ["31 karakter", "a".repeat(31)],
    ["kosong", ""],
    ["hanya spasi", "   "],
    ["spasi di tengah", "ui x"],
    ["karakter non-ASCII", "é"],
  ])("menolak %s", (_label, input) => expect(ok(bugLabel, input)).toBe(false));
});

describe("bugLink", () => {
  it("menerima url http/https dengan judul opsional", () => {
    expect(bugLink.parse({ url: "https://example.com/a?b=1" })).toEqual({ url: "https://example.com/a?b=1" });
    expect(bugLink.parse({ url: "http://example.com", title: "  Tiket  " })).toEqual({
      url: "http://example.com",
      title: "Tiket",
    });
  });
  it.each([
    ["javascript:", { url: "javascript:alert(1)" }],
    ["tanpa //", { url: "http:foo" }],
    ["ftp", { url: "ftp://example.com/x" }],
    ["kredensial", { url: "https://u:p@x.io" }],
    ["username saja", { url: "https://u@x.io" }],
    ["2001 karakter", { url: `https://example.com/${"a".repeat(2001 - 20)}` }],
    ["judul 101 karakter", { url: "https://example.com", title: "a".repeat(101) }],
  ])("menolak %s", (_label, input) => expect(ok(bugLink, input)).toBe(false));

  it.each(["", "   "])("menganggap judul %j sebagai tidak ada", (title) =>
    expect(bugLink.parse({ url: "https://example.com", title })).toEqual({ url: "https://example.com" }),
  );

  it("menerima url 2000 karakter dan judul 100 karakter", () =>
    expect(ok(bugLink, { url: `https://example.com/${"a".repeat(2000 - 20)}`, title: "a".repeat(100) })).toBe(true));
});

describe("createBugBody", () => {
  const base = { title: "Tombol tidak berfungsi" };

  it("hanya judul yang wajib", () => expect(createBugBody.parse(base)).toEqual(base));

  it("menormalkan judul dan label", () => {
    expect(createBugBody.parse({ title: "  Judul  ", labels: [" UI ", "api"] })).toEqual({
      title: "Judul",
      labels: ["ui", "api"],
    });
  });

  it("menerima semua field", () => {
    expect(
      ok(createBugBody, {
        ...base,
        description: "x",
        priority: "urgent",
        severity: "blocker",
        assigneeId: UUID_A,
        labels: ["ui"],
        links: [{ url: "https://example.com" }],
        testCaseId: UUID_A,
        runId: UUID_B,
      }),
    ).toBe(true);
  });

  it("menerima assigneeId null", () => expect(ok(createBugBody, { ...base, assigneeId: null })).toBe(true));

  it.each([
    ["judul 2 karakter setelah trim", { title: "  ab " }],
    ["judul 201 karakter", { title: "a".repeat(201) }],
    ["tanpa judul", {}],
    ["deskripsi 20.001 karakter", { title: "abc", description: "a".repeat(20001) }],
    ["prioritas tidak dikenal", { title: "abc", priority: "x" }],
    ["severity tidak dikenal", { title: "abc", severity: "x" }],
    ["assigneeId bukan uuid", { title: "abc", assigneeId: "bukan-uuid" }],
    ["11 label", { title: "abc", labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }],
    ["label duplikat setelah normalisasi", { title: "abc", labels: ["ui", "UI"] }],
    ["label duplikat persis", { title: "abc", labels: ["ui", "ui"] }],
    ["label tidak sah", { title: "abc", labels: ["ui_x"] }],
    ["11 link", { title: "abc", links: Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/${i}` })) }],
    ["link javascript:", { title: "abc", links: [{ url: "javascript:alert(1)" }] }],
    ["runId tanpa testCaseId", { title: "abc", runId: UUID_B }],
  ])("menolak %s", (_label, input) => expect(ok(createBugBody, input)).toBe(false));

  it("menerima deskripsi 20.000 karakter, 10 label, 10 link, judul 200 karakter", () => {
    expect(
      ok(createBugBody, {
        title: "a".repeat(200),
        description: "a".repeat(20000),
        labels: Array.from({ length: 10 }, (_, i) => `l${i}`),
        links: Array.from({ length: 10 }, (_, i) => ({ url: `https://example.com/${i}` })),
      }),
    ).toBe(true);
  });

  it("melaporkan runId tanpa testCaseId pada field runId", () => {
    const result = createBugBody.safeParse({ title: "abc", runId: UUID_B });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["runId"]);
  });
});

describe("updateBugBody", () => {
  it("menolak body yang hanya berisi version", () => expect(ok(updateBugBody, { version: 1 })).toBe(false));
  it("menolak body tanpa version", () => expect(ok(updateBugBody, { title: "abc" })).toBe(false));
  it("menerima version maksimum int4 dan menolak di atasnya", () => {
    expect(ok(updateBugBody, { version: 2_147_483_647, title: "abc" })).toBe(true);
    expect(ok(updateBugBody, { version: 2_147_483_648, title: "abc" })).toBe(false);
  });
  it.each([0, -1, 1.5, "1"])("menolak version %s", (version) =>
    expect(ok(updateBugBody, { version, title: "abc" })).toBe(false),
  );

  it("menerima satu field selain version", () => {
    expect(updateBugBody.parse({ version: 3, title: " Baru " })).toEqual({ version: 3, title: "Baru" });
    expect(ok(updateBugBody, { version: 1, assigneeId: null })).toBe(true);
    expect(ok(updateBugBody, { version: 1, labels: [] })).toBe(true);
    expect(ok(updateBugBody, { version: 1, description: "" })).toBe(true);
  });

  it("menerima status dan resolution (termasuk null)", () => {
    expect(ok(updateBugBody, { version: 1, status: "resolved", resolution: "fixed" })).toBe(true);
    expect(ok(updateBugBody, { version: 1, resolution: null })).toBe(true);
  });

  it.each([
    ["status tidak dikenal", { version: 1, status: "done" }],
    ["resolution tidak dikenal", { version: 1, resolution: "x" }],
    ["label duplikat setelah normalisasi", { version: 1, labels: ["ui", "UI"] }],
    ["11 link", { version: 1, links: Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/${i}` })) }],
    ["judul terlalu pendek", { version: 1, title: " a " }],
  ])("menolak %s", (_label, input) => expect(ok(updateBugBody, input)).toBe(false));
});

describe("commentBody", () => {
  it("men-trim isi", () => expect(commentBody.parse({ body: "  halo  " })).toEqual({ body: "halo" }));
  it.each([
    ["kosong", ""],
    ["hanya spasi", "   "],
    ["10.001 karakter", "a".repeat(10001)],
  ])("menolak %s", (_label, body) => expect(ok(commentBody, { body })).toBe(false));
  it("menerima 10.000 karakter", () => expect(ok(commentBody, { body: "a".repeat(10000) })).toBe(true));
});

describe("karakter kontrol", () => {
  const bad = ["\u0000", "\u0001", "\u001b", "\u007f", "\u0085"];
  const good = "baris 1\n\tbaris 2\r\nlagi";

  it.each(bad)("komentar menolak %j dengan pesan Indonesia", (ch) => {
    const result = commentBody.safeParse({ body: `halo${ch}dunia` });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Teks tidak boleh mengandung karakter kontrol");
  });
  it.each(bad)("judul, deskripsi, dan judul link menolak %j", (ch) => {
    expect(ok(createBugBody, { title: `judul${ch}bug` })).toBe(false);
    expect(ok(createBugBody, { title: "judul bug", description: `desk${ch}` })).toBe(false);
    expect(ok(updateBugBody, { version: 1, description: `desk${ch}` })).toBe(false);
    expect(ok(bugLink, { url: "https://example.com", title: `t${ch}` })).toBe(false);
  });
  it("tab, LF, dan CR tetap diterima", () => {
    expect(ok(commentBody, { body: good })).toBe(true);
    expect(ok(createBugBody, { title: "judul\tbug", description: good })).toBe(true);
    expect(ok(bugLink, { url: "https://example.com", title: "a\tb" })).toBe(true);
  });
});

describe("bugListQuery", () => {
  it("default: status active, sort updated", () =>
    expect(bugListQuery.parse({})).toEqual({ status: "active", sort: "updated" }));

  it("menerima semua nilai status, assignee, sort", () => {
    for (const status of ["active", "done", "all", ...BUG_STATUSES]) expect(ok(bugListQuery, { status })).toBe(true);
    for (const assignee of ["me", "none", UUID_A]) expect(ok(bugListQuery, { assignee })).toBe(true);
    for (const sort of ["updated", "created", "priority"]) expect(ok(bugListQuery, { sort })).toBe(true);
  });

  it("menormalkan label ke huruf kecil (Review Focus 1)", () =>
    expect(bugListQuery.parse({ label: " UI " }).label).toBe("ui"));

  it.each([
    ["status tidak dikenal", { status: "x" }],
    ["assignee bukan me/none/uuid", { assignee: "budi" }],
    ["sort tidak dikenal", { sort: "x" }],
    ["prioritas tidak dikenal", { priority: "x" }],
    ["severity tidak dikenal", { severity: "x" }],
    ["label tidak sah", { label: "ui_x" }],
    ["q 101 karakter", { q: "a".repeat(101) }],
  ])("menolak %s", (_label, input) => expect(ok(bugListQuery, input)).toBe(false));

  it("men-trim q dan menganggap q kosong sebagai tidak ada", () => {
    expect(bugListQuery.parse({ q: "  halo  " }).q).toBe("halo");
    expect(bugListQuery.parse({ q: "   " })).toEqual({ status: "active", sort: "updated" });
    expect(bugListQuery.parse({ q: "" })).toEqual({ status: "active", sort: "updated" });
  });

  it("menerima q 100 karakter, priority, severity, cursor", () =>
    expect(ok(bugListQuery, { q: "a".repeat(100), priority: "high", severity: "critical", cursor: "abc" })).toBe(true));
});

describe("DTO bug", () => {
  const actor = { id: "u1", name: "Budi" };
  const summary = {
    number: 12,
    title: "Judul",
    status: "open",
    resolution: null,
    priority: "medium",
    severity: "major",
    assignee: null,
    labels: ["ui"],
    updatedAt: "2026-11-04T00:00:00.000Z",
    createdAt: "2026-11-04T00:00:00.000Z",
  };
  const detail = {
    ...summary,
    description: "d",
    reporter: actor,
    links: [{ url: "https://example.com", title: null }],
    testCase: null,
    runId: null,
    version: 1,
    resolvedAt: null,
    closedAt: null,
    testHint: null,
  };

  it("bugDto menerima detail tanpa test asal", () => expect(ok(bugDto, detail)).toBe(true));

  it("bugDto menerima testHint", () =>
    expect(
      ok(bugDto, {
        ...detail,
        testCase: { id: "t1", suite: "s", name: "n" },
        runId: "r1",
        testHint: {
          branch: "main",
          results: [{ runId: "r1", createdAt: "2026-11-04T00:00:00.000Z", status: "failed" }],
          consecutivePasses: 0,
          lastStatus: "failed",
        },
      }),
    ).toBe(true));

  it("activityPageDto membedakan komentar dan event lewat kind", () => {
    const comment = {
      kind: "comment",
      id: "c1",
      author: actor,
      body: null,
      createdAt: "2026-11-04T00:00:00.000Z",
      editedAt: null,
      deletedAt: "2026-11-04T01:00:00.000Z",
    };
    const event = {
      kind: "event",
      id: "7",
      actor,
      field: "status",
      oldValue: "open",
      newValue: "in_progress",
      createdAt: "2026-11-04T00:00:00.000Z",
    };
    expect(ok(activityPageDto, { items: [comment, event], nextCursor: null })).toBe(true);
    expect(ok(activityPageDto, { items: [{ ...event, kind: "comment" }], nextCursor: null })).toBe(false);
  });
});
