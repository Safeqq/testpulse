import { describe, expect, it } from "vitest";
import { INVITATION_TTL_DAYS, invitationStatus } from "./invitations.js";

const now = new Date("2026-01-10T00:00:00.000Z");
const future = new Date("2026-01-11T00:00:00.000Z");
const past = new Date("2026-01-09T00:00:00.000Z");

describe("invitationStatus", () => {
  it("TTL undangan 7 hari", () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
  });

  it("aktif", () => {
    expect(invitationStatus({ expiresAt: future, acceptedAt: null, revokedAt: null }, now)).toBe(
      "active",
    );
  });

  it("acceptedAt terisi -> used", () => {
    expect(invitationStatus({ expiresAt: future, acceptedAt: past, revokedAt: null }, now)).toBe(
      "used",
    );
  });

  it("expiresAt sama dengan now -> expired", () => {
    expect(invitationStatus({ expiresAt: now, acceptedAt: null, revokedAt: null }, now)).toBe(
      "expired",
    );
  });

  it("expiresAt sudah lewat -> expired", () => {
    expect(invitationStatus({ expiresAt: past, acceptedAt: null, revokedAt: null }, now)).toBe(
      "expired",
    );
  });

  it("revoked mengalahkan expired", () => {
    expect(invitationStatus({ expiresAt: past, acceptedAt: null, revokedAt: past }, now)).toBe(
      "revoked",
    );
  });

  it("revoked mengalahkan used", () => {
    expect(invitationStatus({ expiresAt: future, acceptedAt: past, revokedAt: past }, now)).toBe(
      "revoked",
    );
  });

  it("used mengalahkan expired", () => {
    expect(invitationStatus({ expiresAt: past, acceptedAt: past, revokedAt: null }, now)).toBe(
      "used",
    );
  });
});
