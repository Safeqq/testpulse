import { describe, expect, it } from "vitest";
import { addLabels, normalizeErrorKey, remapLinkKeys, validateBugPatch } from "./bugForm";

describe("remapLinkKeys", () => {
  it("memetakan indeks daftar terkirim ke indeks baris formulir saat ada baris kosong di depan", () => {
    // Baris formulir 0 kosong (tidak terkirim), 1 dan 3 terkirim; 2 kosong.
    const rows = [1, 3];
    expect(remapLinkKeys({ "links.0.url": "URL salah", "links.1.title": "Judul panjang" }, rows)).toEqual({
      "links.1.url": "URL salah",
      "links.3.title": "Judul panjang",
    });
  });

  it("menyisakan kunci daftar dan kunci lain, memusatkan error label, dan mempertahankan pesan pertama", () => {
    expect(
      remapLinkKeys({ links: "Maksimal 10 link", title: "Judul wajib", "labels.2": "Label salah", "labels.4": "Lain" }, [0]),
    ).toEqual({ links: "Maksimal 10 link", title: "Judul wajib", labels: "Label salah" });
  });

  it("indeks di luar daftar dibiarkan apa adanya", () => {
    expect(remapLinkKeys({ "links.5.url": "x" }, [2])).toEqual({ "links.5.url": "x" });
  });
});

describe("normalizeErrorKey", () => {
  it("hanya mengubah kunci labels.N", () => {
    expect(normalizeErrorKey("labels.0")).toBe("labels");
    expect(normalizeErrorKey("labels")).toBe("labels");
    expect(normalizeErrorKey("links.0.url")).toBe("links.0.url");
  });
});

describe("addLabels", () => {
  it("menormalkan huruf dan spasi, mengabaikan duplikat dan potongan kosong", () => {
    expect(addLabels(["ui"], [" API ", "UI", "", "backend"])).toEqual({ labels: ["ui", "api", "backend"], rest: "", error: null });
  });

  it("berhenti di label tidak valid dan mengembalikan sisanya", () => {
    const result = addLabels(["ui"], ["ok", "tidak valid!", "lain"]);
    expect(result.labels).toEqual(["ui", "ok"]);
    expect(result.rest).toBe("tidak valid!,lain");
    expect(result.error).toContain("Label hanya boleh berisi");
  });

  it("menolak label ke-11", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `l${i}`);
    expect(addLabels(ten, ["baru"])).toEqual({ labels: ten, rest: "baru", error: "Maksimal 10 label" });
    // Duplikat dari yang sudah ada tidak dihitung sebagai tambahan.
    expect(addLabels(ten, ["l1"]).error).toBeNull();
  });
});

describe("validateBugPatch", () => {
  it("menerima perubahan valid dan mengembalikannya ternormalisasi tanpa version", () => {
    const result = validateBugPatch({
      title: "  Judul baru  ",
      labels: [" UI "],
      links: [{ url: "https://x.example/a", title: "  " }],
    });
    expect(result).toEqual({ ok: true, patch: { title: "Judul baru", labels: ["ui"], links: [{ url: "https://x.example/a" }] } });
  });

  it("memetakan galat ke kunci field, termasuk baris link", () => {
    const result = validateBugPatch({ title: "ab", links: [{ url: "bukan url" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.title).toBe("Judul minimal 3 karakter");
      expect(result.fields["links.0.url"]).toContain("URL harus berupa URL http atau https");
    }
  });

  it("menolak deskripsi lebih dari 20.000 karakter", () => {
    const result = validateBugPatch({ description: "a".repeat(20_001) });
    expect(result).toMatchObject({ ok: false, fields: { description: "Deskripsi maksimal 20.000 karakter" } });
  });
});
