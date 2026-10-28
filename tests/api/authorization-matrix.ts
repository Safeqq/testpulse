import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { ErrorCode } from "@testpulse/shared";
import { buildJUnit } from "../support/junit.js";

/**
 * Matriks otorisasi dari spec §7 ("Matriks otorisasi"), sebagai data.
 * `authorization.spec.ts` membangkitkan satu test per (baris × aktor).
 */
export type Actor = "anonymous" | "nonMemberPrivate" | "nonMemberPublic" | "viewer" | "tester" | "admin";

export const ACTORS: readonly Actor[] = ["anonymous", "nonMemberPrivate", "nonMemberPublic", "viewer", "tester", "admin"];

export interface MatrixContext {
  /** Sesi aktor (anonim = tanpa cookie). */
  http: APIRequestContext;
  slug: string;
  /** ID user aktor; untuk anonim berupa UUID acak yang tidak dikenal. */
  actorId: string;
  /** Anggota `tester` lain di project yang sama, dibuat saat pertama diminta. */
  targetMemberId(): Promise<string>;
  /** Undangan aktif di project yang sama, dibuat saat pertama diminta. */
  invitationId(): Promise<string>;
  /** Run di project yang sama (diunggah dengan token CI), dibuat saat pertama diminta. */
  runId(): Promise<string>;
  /** Test case dari run tersebut, dibuat saat pertama diminta. */
  testCaseId(): Promise<string>;
  /** Token CI aktif di project yang sama, dibuat saat pertama diminta. */
  tokenId(): Promise<string>;
}

export interface MatrixRow {
  /** Nama endpoint untuk judul test. */
  name: string;
  /** Baris tabel §7 yang dicakup (satu baris tabel dapat memuat beberapa method). */
  specRow: string;
  request: (ctx: MatrixContext) => Promise<APIResponse>;
  /** Status yang diharapkan per aktor; `anonymous` = anonim terhadap project privat. */
  expected: Record<Actor, number>;
  /** Status untuk anonim terhadap project publik; default sama dengan `expected.anonymous`. */
  anonymousOnPublic?: number;
  /** Kode error yang diharapkan jika menyimpang dari kode bawaan status (401, 403, 404, 409). */
  errorCodes?: Partial<Record<Actor, ErrorCode>>;
  /**
   * Token CI yang valid hanya diterima di endpoint upload; di semua endpoint lain Bearer diabaikan sehingga
   * pembawanya diperlakukan anonim (spec §7.1). Default `true`; `false` hanya untuk endpoint upload itu sendiri.
   */
  bearerIgnored?: boolean;
}

/** Kode error bawaan untuk status non-2xx pada matriks. */
export const DEFAULT_ERROR_CODE: Record<number, ErrorCode> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "PROJECT_NOT_FOUND",
  409: "LAST_ADMIN",
};

const P = "/api/v1/projects";

/** Laporan JUnit sah minimal untuk baris upload. */
const SAMPLE_REPORT = buildJUnit([{ name: "lulus" }]);

/** Aturan yang sama untuk semua endpoint yang hanya boleh dikelola admin. */
function adminOnly(adminStatus: number): Record<Actor, number> {
  return {
    anonymous: 401,
    nonMemberPrivate: 404,
    nonMemberPublic: 403,
    viewer: 403,
    tester: 403,
    admin: adminStatus,
  };
}

export const MATRIX: MatrixRow[] = [
  // Baris 1: GET project
  {
    name: "GET project",
    specRow: "GET project",
    request: ({ http, slug }) => http.get(`${P}/${slug}`),
    expected: { anonymous: 404, nonMemberPrivate: 404, nonMemberPublic: 200, viewer: 200, tester: 200, admin: 200 },
    anonymousOnPublic: 200,
  },
  // Baris 2: GET members
  {
    name: "GET members",
    specRow: "GET members",
    request: ({ http, slug }) => http.get(`${P}/${slug}/members`),
    expected: { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 403, viewer: 200, tester: 200, admin: 200 },
  },
  // Baris 3: PATCH / DELETE project
  {
    name: "PATCH project",
    specRow: "PATCH / DELETE project",
    request: ({ http, slug }) => http.patch(`${P}/${slug}`, { data: { name: "Nama Baru" } }),
    expected: adminOnly(200),
  },
  {
    name: "DELETE project",
    specRow: "PATCH / DELETE project",
    request: ({ http, slug }) => http.delete(`${P}/${slug}`, { data: { confirmSlug: slug } }),
    expected: adminOnly(204),
  },
  // Baris 4: PATCH member role
  {
    name: "PATCH member role",
    specRow: "PATCH member role",
    request: async (ctx) =>
      ctx.http.patch(`${P}/${ctx.slug}/members/${await ctx.targetMemberId()}`, { data: { role: "viewer" } }),
    expected: adminOnly(200),
  },
  // Baris 5: DELETE member (orang lain)
  {
    name: "DELETE member (orang lain)",
    specRow: "DELETE member (orang lain)",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/members/${await ctx.targetMemberId()}`),
    expected: adminOnly(204),
  },
  // Baris 6: DELETE member (diri sendiri). Admin di sini admin satu-satunya, sehingga 409 LAST_ADMIN.
  {
    name: "DELETE member (diri sendiri)",
    specRow: "DELETE member (diri sendiri)",
    request: ({ http, slug, actorId }) => http.delete(`${P}/${slug}/members/${actorId}`),
    expected: { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 404, viewer: 204, tester: 204, admin: 409 },
    errorCodes: { nonMemberPublic: "MEMBER_NOT_FOUND" },
  },
  // Baris 7: GET / POST / DELETE invitations
  {
    name: "GET invitations",
    specRow: "GET / POST / DELETE invitations",
    request: ({ http, slug }) => http.get(`${P}/${slug}/invitations`),
    expected: adminOnly(200),
  },
  {
    name: "POST invitations",
    specRow: "GET / POST / DELETE invitations",
    request: ({ http, slug }) => http.post(`${P}/${slug}/invitations`, { data: { role: "viewer" } }),
    expected: adminOnly(201),
  },
  {
    name: "DELETE invitations",
    specRow: "GET / POST / DELETE invitations",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/invitations/${await ctx.invitationId()}`),
    expected: adminOnly(204),
  },
  // Tahap 2, §7.1 baris 1: baca hasil mengikuti aturan Tahap 1 (publik → siapa saja; privat → minimal viewer, selain itu 404).
  ...readRows(),
  // Tahap 2, §7.1 baris 2: hapus run = tester+.
  {
    name: "DELETE run",
    specRow: "DELETE run",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/runs/${await ctx.runId()}`),
    expected: { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 403, viewer: 403, tester: 204, admin: 204 },
  },
  // Tahap 2, §7.1 baris 3: CRUD token = admin.
  {
    name: "GET tokens",
    specRow: "GET/POST/DELETE tokens",
    request: ({ http, slug }) => http.get(`${P}/${slug}/tokens`),
    expected: adminOnly(200),
  },
  {
    name: "POST tokens",
    specRow: "GET/POST/DELETE tokens",
    request: ({ http, slug }) => http.post(`${P}/${slug}/tokens`, { data: { name: "Token baru" } }),
    expected: adminOnly(201),
  },
  {
    name: "DELETE tokens",
    specRow: "GET/POST/DELETE tokens",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/tokens/${await ctx.tokenId()}`),
    expected: adminOnly(204),
  },
  // Tahap 2, §7.1 baris 4: cookie sesi tanpa token tidak berlaku di endpoint upload, apa pun role-nya.
  {
    name: "POST runs dengan cookie sesi (tanpa token)",
    specRow: "POST runs dengan cookie sesi (tanpa token)",
    request: ({ http, slug }) =>
      http.post(`${P}/${slug}/runs?branch=main`, { headers: { "content-type": "application/xml" }, data: SAMPLE_REPORT }),
    expected: { anonymous: 401, nonMemberPrivate: 401, nonMemberPublic: 401, viewer: 401, tester: 401, admin: 401 },
    bearerIgnored: false,
  },
];

/** Endpoint baca hasil: sama untuk semua, jadi dibangkitkan dari daftar path. */
function readRows(): MatrixRow[] {
  const read: Record<Actor, number> = {
    anonymous: 404,
    nonMemberPrivate: 404,
    nonMemberPublic: 200,
    viewer: 200,
    tester: 200,
    admin: 200,
  };
  const endpoints: Array<{ name: string; path: (ctx: MatrixContext) => Promise<string> | string }> = [
    { name: "GET branches", path: ({ slug }) => `${P}/${slug}/branches` },
    { name: "GET runs", path: ({ slug }) => `${P}/${slug}/runs` },
    { name: "GET run", path: async (ctx) => `${P}/${ctx.slug}/runs/${await ctx.runId()}?status=all` },
    { name: "GET stats", path: ({ slug }) => `${P}/${slug}/stats` },
    { name: "GET flaky", path: ({ slug }) => `${P}/${slug}/flaky` },
    { name: "GET test history", path: async (ctx) => `${P}/${ctx.slug}/tests/${await ctx.testCaseId()}/history` },
  ];
  return endpoints.map(({ name, path }) => ({
    name,
    specRow: "GET branches/runs/run/stats/flaky/history",
    request: async (ctx) => ctx.http.get(await path(ctx)),
    expected: read,
    anonymousOnPublic: 200,
  }));
}
