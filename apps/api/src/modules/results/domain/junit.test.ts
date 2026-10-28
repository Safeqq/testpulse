import { describe, expect, it } from "vitest";
import {
  InvalidReportError,
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  MAX_SUITE_DEPTH,
  MAX_TESTCASES,
  parseJUnit,
  truncateUtf8,
} from "./junit.js";

function suite(cases: string, attrs = 'name="S"'): string {
  return `<testsuite ${attrs}>${cases}</testsuite>`;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("constants", () => {
  it("memakai batas dari spec", () => {
    expect(MAX_TESTCASES).toBe(20000);
    expect(MAX_NAME_LENGTH).toBe(500);
    expect(MAX_MESSAGE_BYTES).toBe(4096);
  });
});

describe("parseJUnit - struktur dasar", () => {
  it("mem-parse root <testsuites> bersarang", () => {
    const xml = `<?xml version="1.0"?>
<testsuites time="4.5">
  <testsuite name="outer">
    <testsuite name="inner"><testcase name="a" time="1"/></testsuite>
    <testcase name="b" time="2"/>
  </testsuite>
  <testsuite name="second"><testcase name="c"/></testsuite>
</testsuites>`;
    const report = parseJUnit(xml);
    expect(report.results.map((r) => `${r.suite}/${r.name}`).sort()).toEqual(["inner/a", "outer/b", "second/c"]);
    expect(report.durationMs).toBe(4500);
  });

  it("mem-parse root <testsuite> tunggal", () => {
    const report = parseJUnit(suite('<testcase name="a" time="0.5"/>', 'name="S" time="9"'));
    expect(report.results).toHaveLength(1);
    expect(report.durationMs).toBe(9000);
  });

  it("classname diutamakan atas nama suite", () => {
    const report = parseJUnit(suite('<testcase classname="com.x.Foo" name="a"/><testcase name="b"/>'));
    expect(report.results.map((r) => r.suite)).toEqual(["com.x.Foo", "S"]);
  });

  it("nama suite diwarisi dari testsuite induk bila testsuite terdekat tak bernama", () => {
    const report = parseJUnit(`<testsuites><testsuite name="P"><testsuite><testcase name="a"/></testsuite></testsuite></testsuites>`);
    expect(report.results[0]?.suite).toBe("P");
  });

  it("suite dan name di-trim", () => {
    const report = parseJUnit(suite('<testcase classname="  C  " name="  n  "/>'));
    expect(report.results[0]).toMatchObject({ suite: "C", name: "n" });
  });

  it("mendekode entity XML standar tanpa memperluas entity lain", () => {
    const report = parseJUnit(suite('<testcase name="a &lt; b &amp;&amp; c &#233; &#x1F600; &amp;lt; &bogus; &#0; &#xD800;"/>'));
    expect(report.results[0]?.name).toBe("a < b && c é \u{1F600} &lt; &bogus; &#0; &#xD800;");
  });
});

describe("parseJUnit - status", () => {
  it("failure, error, skipped, dan passed", () => {
    const report = parseJUnit(
      suite(`
        <testcase name="f"><failure message="boom"/></testcase>
        <testcase name="e"><error message="err"/></testcase>
        <testcase name="s"><skipped/></testcase>
        <testcase name="p"/>`),
    );
    expect(report.results.map((r) => [r.name, r.status])).toEqual([
      ["f", "failed"],
      ["e", "failed"],
      ["s", "skipped"],
      ["p", "passed"],
    ]);
    for (const r of report.results) expect(r).toMatchObject({ flakyInRun: false, retries: 0 });
  });

  it("failure mengalahkan skipped pada satu testcase", () => {
    const report = parseJUnit(suite('<testcase name="x"><skipped/><failure/></testcase>'));
    expect(report.results[0]?.status).toBe("failed");
  });
});

describe("parseJUnit - durasi", () => {
  it("time=1.2345 dibulatkan ke 1235 ms", () => {
    expect(parseJUnit(suite('<testcase name="a" time="1.2345"/>')).results[0]?.durationMs).toBe(1235);
  });

  it.each(["abc", "-3", "NaN", "Infinity", "1,5", ""])("time invalid %j -> 0", (time) => {
    expect(parseJUnit(suite(`<testcase name="a" time="${time}"/>`)).results[0]?.durationMs).toBe(0);
  });

  it("tanpa time -> 0", () => {
    expect(parseJUnit(suite('<testcase name="a"/>')).results[0]?.durationMs).toBe(0);
  });

  it("durasi run = jumlah durasi test bila root tanpa time", () => {
    const report = parseJUnit(suite('<testcase name="a" time="1"/><testcase name="b" time="2.5"/>'));
    expect(report.durationMs).toBe(3500);
  });

  it("durasi run = jumlah durasi bila time root invalid", () => {
    const report = parseJUnit(suite('<testcase name="a" time="1"/>', 'name="S" time="oops"'));
    expect(report.durationMs).toBe(1000);
  });

  it("durasi run dihitung dari hasil setelah penggabungan", () => {
    const report = parseJUnit(suite('<testcase name="a" time="1"><failure/></testcase><testcase name="a" time="2"/>'));
    expect(report.durationMs).toBe(3000);
  });
});

describe("parseJUnit - pesan", () => {
  it("dari atribut message", () => {
    const r = parseJUnit(suite('<testcase name="a"><failure message="expected 1"/></testcase>')).results[0];
    expect(r?.message).toBe("expected 1");
  });

  it("dari isi teks failure/error (termasuk CDATA)", () => {
    const r = parseJUnit(suite('<testcase name="a"><error><![CDATA[Trace <here>]]></error></testcase>')).results[0];
    expect(r?.message).toBe("Trace <here>");
  });

  it("dari isi teks failure yang juga punya atribut lain", () => {
    const r = parseJUnit(suite('<testcase name="a"><failure type="X">stack &amp; trace</failure></testcase>')).results[0];
    expect(r?.message).toBe("stack & trace");
  });

  it("atribut message lebih diutamakan daripada teks", () => {
    const r = parseJUnit(suite('<testcase name="a"><failure message="short">long trace</failure></testcase>')).results[0];
    expect(r?.message).toBe("short");
  });

  it("null untuk test lulus dan skip, serta failure tanpa pesan", () => {
    const report = parseJUnit(suite('<testcase name="p"/><testcase name="s"><skipped message="x"/></testcase><testcase name="f"><failure/></testcase>'));
    expect(report.results.map((r) => r.message)).toEqual([null, null, null]);
  });
});

describe("parseJUnit - penggabungan kemunculan ganda", () => {
  it("gagal, gagal, lulus -> passed, flaky, retries 2, durasi dijumlah, pesan dari kegagalan terakhir", () => {
    const report = parseJUnit(
      suite(`
        <testcase name="a" time="1"><failure message="first"/></testcase>
        <testcase name="a" time="2"><failure message="second"/></testcase>
        <testcase name="a" time="0.5"/>`),
    );
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toEqual({
      suite: "S",
      name: "a",
      status: "passed",
      flakyInRun: true,
      retries: 2,
      durationMs: 3500,
      message: "second",
    });
  });

  it("gagal -> lulus: retries 1", () => {
    const report = parseJUnit(
      suite('<testcase name="a" time="1"><failure message="x"/></testcase><testcase name="a" time="1"/>'),
    );
    expect(report.results[0]).toMatchObject({ status: "passed", flakyInRun: true, retries: 1, durationMs: 2000, message: "x" });
  });

  it("lulus lalu gagal juga dianggap flaky dan lulus", () => {
    const report = parseJUnit(suite('<testcase name="a"/><testcase name="a"><failure message="x"/></testcase>'));
    expect(report.results[0]).toMatchObject({ status: "passed", flakyInRun: true, retries: 1 });
  });

  it("semua gagal -> failed, retries sesuai, tidak flaky", () => {
    const report = parseJUnit(
      suite('<testcase name="a"><failure message="1"/></testcase><testcase name="a"><failure message="2"/></testcase><testcase name="a"><error message="3"/></testcase>'),
    );
    expect(report.results[0]).toMatchObject({ status: "failed", flakyInRun: false, retries: 2, message: "3" });
  });

  it("semua skip -> skipped", () => {
    const report = parseJUnit(suite('<testcase name="a"><skipped/></testcase><testcase name="a"><skipped/></testcase>'));
    expect(report.results[0]).toMatchObject({ status: "skipped", flakyInRun: false, retries: 1 });
  });

  it("lulus + lulus -> passed, tidak flaky, retries 1", () => {
    const report = parseJUnit(suite('<testcase name="a"/><testcase name="a"/>'));
    expect(report.results[0]).toMatchObject({ status: "passed", flakyInRun: false, retries: 1 });
  });

  it("skip diabaikan saat ada kemunculan lain (skip + gagal -> failed)", () => {
    const report = parseJUnit(suite('<testcase name="a"><skipped/></testcase><testcase name="a"><failure message="m"/></testcase>'));
    expect(report.results[0]).toMatchObject({ status: "failed", message: "m" });
  });

  it("Review Focus 2: name sama di suite A dan B -> dua hasil terpisah, bukan retry", () => {
    const xml = `<testsuites>
      <testsuite name="A"><testcase name="login"/></testsuite>
      <testsuite name="B"><testcase name="login"><failure message="x"/></testcase></testsuite>
    </testsuites>`;
    const report = parseJUnit(xml);
    expect(report.results).toHaveLength(2);
    expect(report.results.map((r) => [r.suite, r.status, r.retries, r.flakyInRun])).toEqual([
      ["A", "passed", 0, false],
      ["B", "failed", 0, false],
    ]);
  });

  it("classname sama dengan name berbeda tetap terpisah", () => {
    const report = parseJUnit(suite('<testcase classname="C" name="a"/><testcase classname="C" name="b"/>'));
    expect(report.results).toHaveLength(2);
  });
});

describe("parseJUnit - konvensi Surefire", () => {
  it("<flakyFailure> x2 pada testcase lulus -> flaky, retries 2", () => {
    const xml = suite(
      '<testcase name="a" time="1"><flakyFailure message="f1"/><flakyFailure message="f2"/></testcase>',
    );
    expect(parseJUnit(xml).results[0]).toMatchObject({ status: "passed", flakyInRun: true, retries: 2 });
  });

  it("<rerunFailure> pada testcase lulus -> flaky, retries 1", () => {
    const xml = suite('<testcase name="a"><rerunFailure message="f1"/></testcase>');
    expect(parseJUnit(xml).results[0]).toMatchObject({ status: "passed", flakyInRun: true, retries: 1 });
  });

  it("<rerunFailure> pada testcase gagal tidak membuatnya flaky", () => {
    const xml = suite('<testcase name="a"><failure message="x"/><rerunFailure message="f1"/></testcase>');
    expect(parseJUnit(xml).results[0]).toMatchObject({ status: "failed", flakyInRun: false, retries: 0 });
  });
});

describe("parseJUnit - penolakan", () => {
  it("menolak <!DOCTYPE dengan entity", () => {
    const xml = '<!DOCTYPE x [<!ENTITY a "b">]><testsuite name="S"><testcase name="&a;"/></testsuite>';
    expect(() => parseJUnit(xml)).toThrow(InvalidReportError);
  });

  it("menolak <!doctype huruf kecil", () => {
    expect(() => parseJUnit('<!doctype html><testsuite name="S"><testcase name="a"/></testsuite>')).toThrow(InvalidReportError);
  });

  it("menolak DOCTYPE yang didahului BOM atau whitespace", () => {
    expect(() => parseJUnit('\uFEFF  <!DocType x><testsuite name="S"><testcase name="a"/></testsuite>')).toThrow(InvalidReportError);
  });

  it("menolak XML rusak", () => {
    expect(() => parseJUnit('<testsuite name="S"><testcase name="a"></testsuite>')).toThrow(InvalidReportError);
    expect(() => parseJUnit("bukan xml")).toThrow(InvalidReportError);
    expect(() => parseJUnit("")).toThrow(InvalidReportError);
  });

  it.each([
    ["U+0000 di nama", '<testcase name="a\u0000b"/>'],
    ["U+0001 di pesan", '<testcase name="a"><failure message="x\u0001"/></testcase>'],
    ["U+001F di teks failure", '<testcase name="a"><failure>boom\u001F</failure></testcase>'],
    ["U+000B di CDATA", '<testcase name="a"><error><![CDATA[x\u000By]]></error></testcase>'],
    ["U+FFFE", '<testcase name="a￾"/>'],
    ["U+FFFF", '<testcase name="a￿"/>'],
    ["high surrogate tunggal", '<testcase name="a\uD800b"/>'],
    ["low surrogate tunggal", '<testcase name="a\uDC00b"/>'],
  ])("menolak karakter mentah di luar XML Char: %s", (_name, cases) => {
    expect(() => parseJUnit(suite(cases))).toThrow(InvalidReportError);
  });

  it("menerima tab, LF, CR, dan karakter non-BMP mentah (pasangan surrogate sah)", () => {
    const report = parseJUnit(`<testsuite name="S">\t\r\n<testcase name="a\u{1F600}\u{10FFFF}�"/></testsuite>`);
    expect(report.results[0]?.name).toBe("a\u{1F600}\u{10FFFF}�");
  });

  it("menolak root bukan testsuites/testsuite", () => {
    expect(() => parseJUnit("<html><body><testcase name='a'/></body></html>")).toThrow(InvalidReportError);
  });

  it("menolak <testsuites/> kosong dan suite tanpa testcase", () => {
    expect(() => parseJUnit("<testsuites/>")).toThrow(InvalidReportError);
    expect(() => parseJUnit('<testsuites><testsuite name="S"/></testsuites>')).toThrow(InvalidReportError);
  });

  it("menolak lebih dari 20.000 testcase, menerima tepat 20.000", () => {
    const make = (n: number) => suite(Array.from({ length: n }, (_, i) => `<testcase name="t${i}"/>`).join(""));
    expect(parseJUnit(make(MAX_TESTCASES)).results).toHaveLength(MAX_TESTCASES);
    expect(() => parseJUnit(make(MAX_TESTCASES + 1))).toThrow(InvalidReportError);
  });

  it("InvalidReportError membawa nama dan pesan", () => {
    const err = new InvalidReportError("x");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidReportError");
    expect(err.message).toBe("x");
  });
});

describe("parseJUnit - pemotongan", () => {
  it("nama 600 karakter dipotong menjadi 500", () => {
    const r = parseJUnit(suite(`<testcase name="${"a".repeat(600)}" classname="${"b".repeat(600)}"/>`)).results[0];
    expect(r?.name).toHaveLength(500);
    expect(r?.suite).toHaveLength(500);
  });

  it("pemotongan nama tidak memecah surrogate pair", () => {
    const name = "x".repeat(499) + "\u{1F600}" + "tail";
    const r = parseJUnit(suite(`<testcase name="${name}"/>`)).results[0];
    expect(Array.from(r?.name ?? "")).toHaveLength(500);
    expect(r?.name.endsWith("\u{1F600}")).toBe(true);
  });

  it("Review Focus 3: pesan 5000 karakter é dipotong <= 4096 byte tanpa karakter pengganti", () => {
    const xml = suite(`<testcase name="a"><failure message="${"é".repeat(5000)}"/></testcase>`);
    const msg = parseJUnit(xml).results[0]?.message ?? "";
    expect(Buffer.byteLength(msg)).toBeLessThanOrEqual(4096);
    expect(msg.endsWith("\uFFFD")).toBe(false);
    expect(msg).toBe("é".repeat(2048));
  });
});

describe("parseJUnit - encoding", () => {
  it("Review Focus 1: BOM + CRLF + nama berisi emoji dan aksen ter-parse utuh", () => {
    const xml =
      "\uFEFF<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<testsuites>\r\n  <testsuite name=\"S\">\r\n    <testcase name=\"login ✅ café\" time=\"0.1\"/>\r\n  </testsuite>\r\n</testsuites>\r\n";
    const report = parseJUnit(xml);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.name).toBe("login ✅ café");
  });
});

describe("truncateUtf8", () => {
  it("mengembalikan teks apa adanya bila muat", () => {
    expect(truncateUtf8("halo", 10)).toBe("halo");
    expect(truncateUtf8("halo", 4)).toBe("halo");
  });

  it("memotong ASCII tepat pada batas", () => expect(truncateUtf8("abcdef", 3)).toBe("abc"));

  it("tidak memecah karakter 2 byte", () => expect(truncateUtf8("ééé", 5)).toBe("éé"));

  it("tidak memecah karakter 3 byte", () => expect(truncateUtf8("✅✅", 5)).toBe("✅"));

  it("tidak memecah surrogate pair (emoji 4 byte)", () => {
    const out = truncateUtf8("a\u{1F600}\u{1F600}", 6);
    expect(out).toBe("a\u{1F600}");
    expect(out).not.toMatch(LONE_SURROGATE);
    expect(truncateUtf8("\u{1F600}", 3)).toBe("");
  });

  it("maxBytes 0 -> string kosong", () => expect(truncateUtf8("abc", 0)).toBe(""));

  it("hasil selalu <= maxBytes dan tanpa surrogate tunggal untuk berbagai batas", () => {
    const text = "aé✅\u{1F600}".repeat(10);
    for (let max = 0; max <= 60; max++) {
      const out = truncateUtf8(text, max);
      expect(Buffer.byteLength(out)).toBeLessThanOrEqual(max);
      expect(out).not.toMatch(LONE_SURROGATE);
      expect(text.startsWith(out)).toBe(true);
    }
  });
});

describe("parseJUnit - fix round 1", () => {
  it("durasi per testcase dijepit ke int4 max", () => {
    const report = parseJUnit(suite('<testcase name="a" time="9999999"/>'));
    expect(report.results[0]?.durationMs).toBe(2147483647);
    expect(report.durationMs).toBe(2147483647);
  });

  it("time sangat besar (Infinity setelah Number) tetap dijepit", () => {
    expect(parseJUnit(suite(`<testcase name="a" time="${"9".repeat(400)}"/>`)).results[0]?.durationMs).toBe(2147483647);
  });

  it("jumlah durasi gabungan dan durasi run dijepit", () => {
    const report = parseJUnit(suite('<testcase name="a" time="2000000"/><testcase name="a" time="2000000"/><testcase name="b" time="2000000"/>'));
    expect(report.results[0]?.durationMs).toBe(2147483647);
    expect(report.durationMs).toBe(2147483647);
  });

  it("durasi time root yang sangat besar dijepit", () => {
    expect(parseJUnit(suite('<testcase name="a"/>', 'name="S" time="99999999"')).durationMs).toBe(2147483647);
  });

  it("isi CDATA tidak didekode entity-nya", () => {
    const r = parseJUnit(suite('<testcase name="a"><failure><![CDATA[a &amp; b]]></failure></testcase>')).results[0];
    expect(r?.message).toBe("a &amp; b");
  });

  it("teks biasa didekode sementara CDATA di sebelahnya tetap literal", () => {
    const r = parseJUnit(suite('<testcase name="a"><failure type="X">x &amp; <![CDATA[a &lt; b]]></failure></testcase>')).results[0];
    expect(r?.message).toContain("x &");
    expect(r?.message).toContain("a &lt; b");
  });

  it("beberapa CDATA digabung apa adanya", () => {
    const r = parseJUnit(suite('<testcase name="a"><error><![CDATA[one ]]><![CDATA[two]]></error></testcase>')).results[0];
    expect(r?.message).toBe("one two");
  });

  it.each(["&#1;", "&#xFFFE;", "&#xFFFF;", "&#xB;", "&#x110000;", "&#xD800;", "&#0;"])(
    "referensi karakter di luar XML Char dibiarkan literal: %s",
    (ref) => {
      expect(parseJUnit(suite(`<testcase name="a${ref}b"/>`)).results[0]?.name).toBe(`a${ref}b`);
    },
  );

  it("referensi karakter yang sah didekode (tab, LF, batas bawah dan atas rentang)", () => {
    const report = parseJUnit(suite('<testcase name="a&#9;b&#x20;c&#xD7FF;&#xE000;&#xFFFD;&#x10000;&#x10FFFF;"/>'));
    expect(report.results[0]?.name).toBe("a\tb c" + String.fromCodePoint(0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff));
  });

  it("menolak testsuite bersarang ~200 tingkat", () => {
    const depth = 200;
    const xml = '<testsuite name="S">'.repeat(depth) + '<testcase name="a"/>' + "</testsuite>".repeat(depth);
    expect(() => parseJUnit(xml)).toThrow(InvalidReportError);
  });

  it("menerima nesting dalam yang masih di bawah batas", () => {
    const depth = MAX_SUITE_DEPTH;
    const xml = '<testsuite name="S">'.repeat(depth) + '<testcase name="a"/>' + "</testsuite>".repeat(depth);
    expect(parseJUnit(xml).results).toHaveLength(1);
  });

  it("<flakyError> pada testcase lulus -> flaky, retries dihitung bersama flakyFailure", () => {
    const xml = suite('<testcase name="a"><flakyError message="e"/><flakyFailure message="f"/></testcase>');
    expect(parseJUnit(xml).results[0]).toMatchObject({ status: "passed", flakyInRun: true, retries: 2 });
  });
});
