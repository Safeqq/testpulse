import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { MergeError, mergeJUnit } from "./merge.js";

const SUITES_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="vitest" time="1.5">
  <testsuite name="a.test.ts" tests="1" time="0.1"><testcase classname="a" name="satu" time="0.1"/></testsuite>
  <testsuite name="b.test.ts" tests="1"><testcase classname="b" name="dua"><failure message="x &lt; y">boom</failure></testcase></testsuite>
</testsuites>`;

const SUITE_DOC = `<testsuite name="c" tests="1"><testcase name="tiga"><skipped/></testcase></testsuite>`;

type Node = Record<string, unknown>;
const parse = (xml: string): Node =>
  new XMLParser({ ignoreAttributes: false, isArray: (n) => n === "testsuite" || n === "testcase" }).parse(xml) as Node;
const suitesOf = (xml: string): Node[] => ((parse(xml).testsuites as Node).testsuite ?? []) as Node[];

function mergeError(docs: string[]): MergeError {
  try {
    mergeJUnit(docs);
  } catch (err) {
    expect(err).toBeInstanceOf(MergeError);
    return err as MergeError;
  }
  throw new Error("mergeJUnit seharusnya melempar MergeError");
}

describe("mergeJUnit", () => {
  it("menggabungkan dua dokumen dengan root berbeda menjadi satu <testsuites>", () => {
    const merged = mergeJUnit([SUITES_DOC, SUITE_DOC]);
    expect(Object.keys(parse(merged)).filter((k) => !k.startsWith("?"))).toEqual(["testsuites"]);
    expect(suitesOf(merged).map((s) => s["@_name"])).toEqual(["a.test.ts", "b.test.ts", "c"]);
  });

  it("mempertahankan isi suite apa adanya (entity, atribut, CDATA)", () => {
    const withCdata = `<testsuite name="d"><testcase name="e"><failure><![CDATA[<b>a > b</b>]]></failure></testcase></testsuite>`;
    const merged = mergeJUnit([SUITES_DOC, withCdata]);
    expect(merged).toContain(`message="x &lt; y"`);
    expect(merged).toContain("<![CDATA[<b>a > b</b>]]>");
  });

  it("tidak membawa atribut <testsuites> asli (durasi dihitung server dari test)", () => {
    const merged = mergeJUnit([SUITES_DOC]);
    expect(merged).not.toContain("vitest");
    expect(merged).not.toContain('time="1.5"');
  });

  it("satu dokumen <testsuite> tunggal dibungkus <testsuites>", () => {
    expect(suitesOf(mergeJUnit([SUITE_DOC]))).toHaveLength(1);
  });

  it("<testsuites> kosong tidak menambah suite", () => {
    const merged = mergeJUnit(["<testsuites/>", "<testsuites></testsuites>", SUITE_DOC]);
    expect(suitesOf(merged)).toHaveLength(1);
  });

  it("menangani testsuite bersarang, komentar, dan > di dalam nilai atribut", () => {
    const doc = `<?xml version="1.0"?><!-- c --><testsuites><!-- <testsuite name="hantu"> --><testsuite name="a > b"><testsuite name="dalam"><testcase name="t"/></testsuite></testsuite></testsuites>`;
    const merged = mergeJUnit([doc]);
    expect(merged).not.toContain("hantu");
    const suites = suitesOf(merged);
    expect(suites).toHaveLength(1);
    expect(suites[0]?.["@_name"]).toBe("a > b");
    expect(((suites[0]?.testsuite ?? []) as Node[])[0]?.["@_name"]).toBe("dalam");
  });

  it("mengabaikan elemen selain <testsuite> di bawah <testsuites>", () => {
    const doc = `<testsuites><properties><property name="p" value="v"/></properties><testsuite name="a"/></testsuites>`;
    const merged = mergeJUnit([doc]);
    expect(merged).not.toContain("properties");
    expect(suitesOf(merged)).toHaveLength(1);
  });

  it("menghapus BOM di awal dokumen", () => {
    expect(suitesOf(mergeJUnit(["﻿" + SUITES_DOC]))).toHaveLength(2);
  });

  it.each([
    ["<!DOCTYPE", `<!DOCTYPE testsuites [<!ENTITY x "y">]><testsuites><testsuite name="a"/></testsuites>`],
    ["<!doctype (huruf kecil)", `<!doctype testsuites><testsuites/>`],
  ])("menolak %s dan menyebut indeks dokumen", (_label, doc) => {
    const err = mergeError([SUITE_DOC, doc]);
    expect(err.message).toContain("DOCTYPE");
    expect(err.index).toBe(1);
  });

  it("menolak XML rusak dan menyebut indeks dokumen", () => {
    const err = mergeError([SUITE_DOC, "<testsuites><testsuite></testsuites>"]);
    expect(err.message).toContain("XML tidak valid");
    expect(err.index).toBe(1);
  });

  it("menolak root yang bukan testsuites/testsuite", () => {
    expect(mergeError(["<html><body/></html>"]).message).toContain("bukan laporan JUnit");
  });

  it("menolak dokumen kosong", () => {
    expect(mergeError(["   "]).index).toBe(0);
  });
});
