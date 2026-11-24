import { describe, expect, it } from "vitest";
import { canJoin, canSubmit, joinTransition, leaveTransition, participantState, type AccessInput } from "./access.js";

const base: AccessInput = { authenticated: true, isMember: false, participantStatus: null, effectiveStatus: "open" };

describe("participantState", () => {
  it.each<[string, Partial<AccessInput>, string]>([
    ["anonim di cycle open", { authenticated: false }, "anonymous"],
    ["login non-peserta", {}, "can_join"],
    ["peserta aktif", { participantStatus: "active" }, "joined"],
    ["peserta keluar", { participantStatus: "left" }, "left"],
    ["dikeluarkan", { participantStatus: "removed" }, "removed"],
    ["dikeluarkan di cycle closed tetap removed", { participantStatus: "removed", effectiveStatus: "closed" }, "removed"],
    ["anggota project", { isMember: true }, "member"],
    ["anggota yang dulu peserta", { isMember: true, participantStatus: "active" }, "member"],
    ["cycle closed untuk login", { effectiveStatus: "closed" }, "closed"],
    ["cycle closed untuk anonim", { authenticated: false, effectiveStatus: "closed" }, "closed"],
    ["peserta aktif di cycle closed", { participantStatus: "active", effectiveStatus: "closed" }, "closed"],
    ["draft dianggap closed", { effectiveStatus: "draft" }, "closed"],
  ])("%s", (_, over, expected) => {
    expect(participantState({ ...base, ...over })).toBe(expected);
  });
});

describe("canJoin", () => {
  it.each<[string, Partial<AccessInput>, string | null]>([
    ["login non-peserta", {}, null],
    ["peserta keluar boleh ikut lagi", { participantStatus: "left" }, null],
    ["sudah aktif (idempoten)", { participantStatus: "active" }, null],
    ["anonim", { authenticated: false }, "UNAUTHENTICATED"],
    ["anggota", { isMember: true }, "MEMBER_CANNOT_JOIN"],
    ["dikeluarkan", { participantStatus: "removed" }, "PARTICIPANT_REMOVED"],
    ["closed", { effectiveStatus: "closed" }, "CYCLE_NOT_OPEN"],
    ["dikeluarkan di cycle closed", { participantStatus: "removed", effectiveStatus: "closed" }, "PARTICIPANT_REMOVED"],
  ])("%s", (_, over, expected) => {
    expect(canJoin({ ...base, ...over })).toBe(expected);
  });
});

describe("canSubmit", () => {
  it.each<[string, Partial<AccessInput>, string | null]>([
    ["peserta aktif di cycle open", { participantStatus: "active" }, null],
    ["anonim", { authenticated: false }, "UNAUTHENTICATED"],
    ["anggota (termasuk peserta yang kemudian menjadi anggota)", { isMember: true, participantStatus: "active" }, "MEMBER_CANNOT_JOIN"],
    ["dikeluarkan", { participantStatus: "removed" }, "PARTICIPANT_REMOVED"],
    ["bukan peserta", {}, "NOT_PARTICIPANT"],
    ["peserta keluar", { participantStatus: "left" }, "NOT_PARTICIPANT"],
    ["peserta aktif tapi cycle closed", { participantStatus: "active", effectiveStatus: "closed" }, "CYCLE_NOT_OPEN"],
  ])("%s", (_, over, expected) => {
    expect(canSubmit({ ...base, ...over })).toBe(expected);
  });
});

// Review Focus 2: keluar tidak boleh "mencuci" status dikeluarkan.
describe("leaveTransition & joinTransition", () => {
  it("peserta aktif keluar → left", () => {
    expect(leaveTransition("active")).toBe("left");
  });

  it("removed tidak berubah saat keluar", () => {
    expect(leaveTransition("removed")).toBeNull();
  });

  it("left dan bukan peserta tidak berubah saat keluar", () => {
    expect(leaveTransition("left")).toBeNull();
    expect(leaveTransition(null)).toBeNull();
  });

  it("ikut: bukan peserta/left/active → active; removed ditolak", () => {
    expect(joinTransition(null)).toBe("active");
    expect(joinTransition("left")).toBe("active");
    expect(joinTransition("active")).toBe("active");
    expect(joinTransition("removed")).toBeNull();
  });
});
