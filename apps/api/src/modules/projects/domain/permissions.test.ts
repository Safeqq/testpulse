import { describe, expect, it } from "vitest";
import type { Role, Visibility } from "@testpulse/shared";
import { decideAccess, type AccessDecision, type ProjectAction } from "./permissions.js";

type Actor = { name: string; authenticated: boolean; visibility: Visibility; role: Role | null };

// Kolom mengikuti matriks otorisasi spec §7.
const actors: Actor[] = [
  { name: "anonim-publik", authenticated: false, visibility: "public", role: null },
  { name: "anonim-privat", authenticated: false, visibility: "private", role: null },
  { name: "bukan-anggota-privat", authenticated: true, visibility: "private", role: null },
  { name: "bukan-anggota-publik", authenticated: true, visibility: "public", role: null },
  { name: "viewer", authenticated: true, visibility: "private", role: "viewer" },
  { name: "tester", authenticated: true, visibility: "private", role: "tester" },
  { name: "admin", authenticated: true, visibility: "private", role: "admin" },
];

const manage: AccessDecision[] = [
  "unauthenticated",
  "unauthenticated",
  "not_found",
  "forbidden",
  "forbidden",
  "forbidden",
  "allow",
];

const matrix: Record<ProjectAction, AccessDecision[]> = {
  //                    anonPub          anonPriv         nonMemPriv   nonMemPub    viewer   tester   admin
  "project:read": ["allow", "not_found", "not_found", "allow", "allow", "allow", "allow"],
  "members:read": [
    "unauthenticated",
    "unauthenticated",
    "not_found",
    "forbidden",
    "allow",
    "allow",
    "allow",
  ],
  "project:manage": manage,
  "members:manage": manage,
  "invitations:manage": manage,
};

describe("decideAccess", () => {
  for (const [action, expected] of Object.entries(matrix) as [ProjectAction, AccessDecision[]][]) {
    describe(action, () => {
      actors.forEach((actor, i) => {
        it(`${actor.name} -> ${expected[i]}`, () => {
          expect(
            decideAccess(action, {
              authenticated: actor.authenticated,
              visibility: actor.visibility,
              role: actor.role,
            }),
          ).toBe(expected[i]);
        });
      });
    });
  }

  it("anggota pada project publik tetap memakai izin rolenya", () => {
    expect(
      decideAccess("project:manage", { authenticated: true, visibility: "public", role: "viewer" }),
    ).toBe("forbidden");
    expect(
      decideAccess("project:manage", { authenticated: true, visibility: "public", role: "admin" }),
    ).toBe("allow");
  });
});
