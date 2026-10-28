import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid.js";

describe("isUuid", () => {
  it.each(["3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b", "3F2B8C1E-9A4D-4E6F-8B7A-1C2D3E4F5A6B"])("menerima %s", (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each(["", "bukan-uuid", "3f2b8c1e9a4d4e6f8b7a1c2d3e4f5a6b", "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6", "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6bx", "zf2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"])(
    "menolak %j",
    (value) => {
      expect(isUuid(value)).toBe(false);
    },
  );
});
