import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { toSaveFailure } from "./bugSave";

describe("toSaveFailure", () => {
  it("409 BUG_CONFLICT menjadi konflik tanpa pesan", () => {
    expect(toSaveFailure(new ApiError(409, "BUG_CONFLICT", "Bug berubah"))).toEqual({ ok: false, conflict: true });
  });

  it("galat lain membawa pesan server dan field-nya", () => {
    expect(toSaveFailure(new ApiError(400, "VALIDATION_ERROR", "Tidak valid", { resolution: "Wajib" }))).toEqual({
      ok: false,
      message: "Tidak valid",
      fields: { resolution: "Wajib" },
    });
    expect(toSaveFailure(new ApiError(409, "INVALID_TRANSITION", "Transisi tidak diizinkan"))).toEqual({
      ok: false,
      message: "Transisi tidak diizinkan",
    });
  });

  it("galat bukan API (jaringan, bug) menjadi pesan umum", () => {
    expect(toSaveFailure(new Error("x"))).toEqual({ ok: false, message: "Terjadi kesalahan. Coba lagi." });
  });
});
