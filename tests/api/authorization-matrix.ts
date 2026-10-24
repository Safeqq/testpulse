import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { ErrorCode } from "@testpulse/shared";

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
}

/** Kode error bawaan untuk status non-2xx pada matriks. */
export const DEFAULT_ERROR_CODE: Record<number, ErrorCode> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "PROJECT_NOT_FOUND",
  409: "LAST_ADMIN",
};

const P = "/api/v1/projects";

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
];
