import { describe, expect, it } from "vitest";
import { describeEvent } from "./bugActivity";

const event = (field: string, oldValue: string | null, newValue: string | null) => ({ field, oldValue, newValue });

describe("describeEvent", () => {
  it("status memakai label tampilan", () => {
    expect(describeEvent(event("status", "open", "in_progress"))).toBe("mengubah status Open → In progress");
    expect(describeEvent(event("status", "resolved", "closed"))).toBe("mengubah status Resolved → Closed");
  });

  it("resolusi: ditetapkan, diganti, dan dihapus", () => {
    expect(describeEvent(event("resolution", null, "fixed"))).toBe("menetapkan resolusi Diperbaiki");
    expect(describeEvent(event("resolution", "fixed", "wont_fix"))).toBe(
      "mengubah resolusi Diperbaiki → Tidak akan diperbaiki",
    );
    expect(describeEvent(event("resolution", "duplicate", null))).toBe("menghapus resolusi (Duplikat)");
  });

  it("prioritas dan severity", () => {
    expect(describeEvent(event("priority", "medium", "urgent"))).toBe("mengubah prioritas Sedang → Mendesak");
    expect(describeEvent(event("severity", "major", "blocker"))).toBe("mengubah severity Major → Blocker");
  });

  it("assignee membawa nama tampilan", () => {
    expect(describeEvent(event("assignee", null, "Budi"))).toBe("menugaskan bug ini ke Budi");
    expect(describeEvent(event("assignee", "Budi", "Sari"))).toBe("mengganti assignee Budi → Sari");
    expect(describeEvent(event("assignee", "Budi", null))).toBe("menghapus assignee (Budi)");
  });

  it("judul, label, deskripsi, dan link", () => {
    expect(describeEvent(event("title", "Lama", "Baru"))).toBe("mengubah judul “Lama” → “Baru”");
    expect(describeEvent(event("labels", "ui", "api, ui"))).toBe("mengubah label ui → api, ui");
    expect(describeEvent(event("labels", null, "ui"))).toBe("mengubah label (kosong) → ui");
    expect(describeEvent(event("description", null, null))).toBe("mengubah deskripsi");
    expect(describeEvent(event("links", null, null))).toBe("mengubah link");
  });

  it("nilai di luar dugaan tidak merusak teks", () => {
    expect(describeEvent(event("status", "aneh", "open"))).toBe("mengubah status aneh → Open");
    expect(describeEvent(event("field-baru", "a", "b"))).toBe("mengubah field-baru");
  });
});
