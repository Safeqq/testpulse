import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildJUnit } from "../support/junit.ts";

function testcases(xml: string): string[] {
  return xml.match(/<testcase\b[^>]*?(?:\/>|>.*?<\/testcase>)/g) ?? [];
}

describe("buildJUnit", () => {
  it("menulis suite sebagai classname dan nama sebagai name; default suite 'suite'", () => {
    const xml = buildJUnit([{ suite: "auth", name: "login" }, { name: "tanpa suite" }]);
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites>/);
    assert.deepEqual(testcases(xml), [
      '<testcase classname="auth" name="login" time="0.1"/>',
      '<testcase classname="suite" name="tanpa suite" time="0.1"/>',
    ]);
  });

  it("memakai timeSec bila diberikan", () => {
    assert.match(buildJUnit([{ name: "a", timeSec: 2.5 }]), /time="2.5"/);
  });

  it("test lulus dengan retries n memuat n kemunculan gagal sebelum yang lulus", () => {
    const cases = testcases(buildJUnit([{ name: "flaky", retries: 2, message: "boom" }]));
    assert.equal(cases.length, 3);
    assert.match(cases[0] ?? "", /<failure message="boom">boom<\/failure>/);
    assert.match(cases[1] ?? "", /<failure /);
    assert.equal(cases[2], '<testcase classname="suite" name="flaky" time="0.1"/>');
  });

  it("test gagal: retries menambah kemunculan gagal, pesan default bila tidak ada", () => {
    const cases = testcases(buildJUnit([{ name: "rusak", status: "failed", retries: 1 }]));
    assert.equal(cases.length, 2);
    for (const c of cases) assert.match(c, /<failure message="Assertion gagal">Assertion gagal<\/failure>/);
  });

  it("test skipped menghasilkan satu <skipped/> dan mengabaikan retries", () => {
    const cases = testcases(buildJUnit([{ name: "lewat", status: "skipped", retries: 3 }]));
    assert.deepEqual(cases, ['<testcase classname="suite" name="lewat" time="0.1"><skipped/></testcase>']);
  });

  it("meng-escape & < > \" ' pada suite, nama, dan pesan", () => {
    const xml = buildJUnit([{ suite: `s&<>"'`, name: `n&<>"'`, status: "failed", message: `m&<>"'` }]);
    const [c] = testcases(xml);
    assert.ok(c);
    assert.ok(c.includes('classname="s&amp;&lt;&gt;&quot;&apos;"'));
    assert.ok(c.includes('name="n&amp;&lt;&gt;&quot;&apos;"'));
    assert.ok(c.includes('<failure message="m&amp;&lt;&gt;&quot;&apos;">m&amp;&lt;&gt;&quot;&apos;</failure>'));
    // Tidak ada karakter terlarang yang lolos mentah ke dalam atribut/teks.
    assert.doesNotMatch(c.replace(/<\/?(?:testcase|failure|skipped)\b[^>]*>/g, ""), /[<>]/);
  });

  it("mengodekan tab, newline, dan carriage return agar pesan multi-baris utuh", () => {
    const [c] = testcases(buildJUnit([{ name: "a\nb", status: "failed", message: "baris1\r\nbaris2\tx" }]));
    assert.ok(c);
    assert.ok(c.includes('name="a&#10;b"'));
    assert.ok(c.includes('message="baris1&#13;&#10;baris2&#9;x"'));
    assert.ok(!/[\n\r\t]/.test(c));
  });
});
