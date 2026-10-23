import { describe, expect, it } from "vitest";
import { wouldLeaveNoAdmin } from "./admins.js";

describe("wouldLeaveNoAdmin", () => {
  it("admin terakhir diturunkan role -> true", () => {
    expect(
      wouldLeaveNoAdmin({ adminCount: 1, targetCurrentRole: "admin", targetNewRole: "tester" }),
    ).toBe(true);
  });

  it("admin terakhir dikeluarkan/keluar (null) -> true", () => {
    expect(
      wouldLeaveNoAdmin({ adminCount: 1, targetCurrentRole: "admin", targetNewRole: null }),
    ).toBe(true);
  });

  it("masih ada admin lain -> false", () => {
    expect(
      wouldLeaveNoAdmin({ adminCount: 2, targetCurrentRole: "admin", targetNewRole: "viewer" }),
    ).toBe(false);
    expect(
      wouldLeaveNoAdmin({ adminCount: 2, targetCurrentRole: "admin", targetNewRole: null }),
    ).toBe(false);
  });

  it("target bukan admin -> false", () => {
    expect(
      wouldLeaveNoAdmin({ adminCount: 1, targetCurrentRole: "tester", targetNewRole: null }),
    ).toBe(false);
    expect(
      wouldLeaveNoAdmin({ adminCount: 1, targetCurrentRole: "viewer", targetNewRole: "admin" }),
    ).toBe(false);
  });

  it("admin tetap admin -> false", () => {
    expect(
      wouldLeaveNoAdmin({ adminCount: 1, targetCurrentRole: "admin", targetNewRole: "admin" }),
    ).toBe(false);
  });
});
