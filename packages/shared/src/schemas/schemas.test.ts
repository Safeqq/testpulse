import { describe, expect, it } from "vitest";
import { createInvitationBody, createProjectBody, registerBody, roleRank, updateProjectBody } from "../index.js";

describe("schemas", () => {
  it("registerBody menormalkan email", () =>
    expect(registerBody.parse({ name: " Budi ", email: "  Budi@Mail.COM ", password: "12345678" })).toEqual({
      name: "Budi",
      email: "budi@mail.com",
      password: "12345678",
    }));

  it.each([
    ["1234567", false],
    ["12345678", true],
    ["a".repeat(128), true],
    ["a".repeat(129), false],
  ])("password %j valid=%s", (pw, ok) =>
    expect(registerBody.safeParse({ name: "A", email: "a@b.co", password: pw }).success).toBe(ok),
  );

  it.each([
    ["", false],
    ["a".repeat(80), true],
    ["a".repeat(81), false],
    ["   ", false],
  ])("nama project %j valid=%s", (name, ok) => expect(createProjectBody.safeParse({ name }).success).toBe(ok));

  it("updateProjectBody wajib minimal satu field", () => expect(updateProjectBody.safeParse({}).success).toBe(false));

  it("createInvitationBody menolak role admin", () =>
    expect(createInvitationBody.safeParse({ role: "admin" }).success).toBe(false));

  it("roleRank berurutan", () =>
    expect(roleRank("admin") > roleRank("tester") && roleRank("tester") > roleRank("viewer")).toBe(true));
});
