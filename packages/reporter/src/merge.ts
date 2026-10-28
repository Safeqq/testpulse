import { XMLValidator } from "fast-xml-parser";

/** Dokumen JUnit ke-`index` (0-based, sesuai urutan masukan) tidak dapat digabung. */
export class MergeError extends Error {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message);
    this.name = "MergeError";
  }
}

const DOCTYPE = /<!doctype/i;

/**
 * Token markup pada dokumen yang sudah lolos `XMLValidator` (well-formed). Urutan alternatif penting: komentar,
 * CDATA, dan PI dikonsumsi utuh sehingga `<` di dalamnya tidak dianggap tag. Atribut dicocokkan per pasangan
 * nama="nilai" agar `>` di dalam nilai atribut tidak mengakhiri tag lebih awal.
 */
const MARKUP =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

/**
 * Mengambil semua `<testsuite>` tingkat atas (anak langsung `<testsuites>`, atau elemen akar bila akarnya
 * `<testsuite>`) sebagai potongan teks asli, tanpa mengubah isinya.
 */
function extractSuites(doc: string, index: number): string[] {
  const suites: string[] = [];
  let depth = 0;
  let rootName: string | undefined;
  let suiteStart = -1;

  for (const m of doc.matchAll(MARKUP)) {
    const name = m[2];
    if (name === undefined) continue; // komentar, CDATA, atau PI
    const closing = m[1] === "/";
    const selfClosing = m[4] === "/";
    const start = m.index;
    const end = start + m[0].length;

    if (closing) depth--;
    else if (depth === 0) rootName = name;

    // `depth` kini adalah kedalaman elemen ini (akar = 0), baik saat dibuka maupun ditutup.
    const isSuiteLevel = rootName === "testsuites" ? depth === 1 : depth === 0;
    if (name === "testsuite" && isSuiteLevel) {
      if (!closing) {
        if (selfClosing) suites.push(doc.slice(start, end));
        else suiteStart = start;
      } else if (suiteStart >= 0) {
        suites.push(doc.slice(suiteStart, end));
        suiteStart = -1;
      }
    }

    if (!closing && !selfClosing) depth++;
  }

  if (rootName !== "testsuites" && rootName !== "testsuite") {
    throw new MergeError("bukan laporan JUnit (elemen akar harus <testsuites> atau <testsuite>)", index);
  }
  return suites;
}

/**
 * Menggabungkan beberapa dokumen JUnit menjadi satu `<testsuites>` berisi semua `<testsuite>` dari tiap dokumen
 * (akar `<testsuites>` atau `<testsuite>`). `<!DOCTYPE` ditolak lebih dulu (XXE/entity expansion); dokumen yang
 * tidak well-formed ditolak. Atribut `<testsuites>` asli (mis. `time`) tidak dibawa: server menghitung durasi dari test.
 * Melempar `MergeError` dengan indeks dokumen penyebabnya.
 */
export function mergeJUnit(docs: string[]): string {
  const suites: string[] = [];
  docs.forEach((raw, index) => {
    const doc = raw.replace(/^﻿/, "");
    if (DOCTYPE.test(doc)) throw new MergeError("memuat <!DOCTYPE>, yang tidak diperbolehkan", index);
    if (doc.trim() === "") throw new MergeError("XML tidak valid: dokumen kosong", index);
    const validity = XMLValidator.validate(doc);
    if (validity !== true) throw new MergeError(`XML tidak valid: ${validity.err.msg} (baris ${validity.err.line})`, index);
    suites.push(...extractSuites(doc, index));
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${suites.join("\n")}</testsuites>\n`;
}
