import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ResultStatus } from "@testpulse/shared";

export const MAX_TESTCASES = 20000;
export const MAX_NAME_LENGTH = 500;
export const MAX_MESSAGE_BYTES = 4096;

export class InvalidReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReportError";
  }
}

export interface ParsedResult {
  suite: string;
  name: string;
  status: ResultStatus;
  flakyInRun: boolean;
  retries: number;
  durationMs: number;
  message: string | null;
}

export interface ParsedReport {
  durationMs: number;
  results: ParsedResult[];
}

type XmlNode = Record<string, unknown>;

interface Occurrence {
  status: ResultStatus;
  /** Jumlah <flakyFailure>/<rerunFailure> pada testcase yang lulus (konvensi Surefire). */
  surefireRetries: number;
  durationMs: number;
  message: string | null;
}

const ARRAY_TAGS = new Set(["testsuite", "testcase", "failure", "error", "skipped", "flakyFailure", "rerunFailure"]);

// Entity tidak di-resolve oleh parser (processEntities: false); hanya entity standar XML dan
// referensi karakter yang didekode di sini, dalam satu lintasan sehingga tidak ada ekspansi berantai.
const parser = new XMLParser({
  processEntities: false,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

const DOCTYPE = /<!doctype/i;
const DURATION = /^(?:\d+\.?\d*|\.\d+)$/;
const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g, (match, hex?: string, dec?: string, named?: string) => {
    if (named) return NAMED_ENTITIES[named] ?? match;
    const codePoint = hex ? parseInt(hex, 16) : parseInt(dec ?? "", 10);
    const valid = codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
    return valid ? String.fromCodePoint(codePoint) : match;
  });
}

function isNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Elemen kosong (`<testcase/>`) di-parse sebagai string kosong; perlakukan sebagai node tanpa atribut. */
function asNodes(value: unknown): XmlNode[] {
  return asList(value).map((item) => (isNode(item) ? item : {}));
}

function attr(node: XmlNode, name: string): string | null {
  const value = node[`@_${name}`];
  if (typeof value !== "string") return null;
  const decoded = decodeEntities(value).trim();
  return decoded === "" ? null : decoded;
}

function elementText(value: unknown): string | null {
  const text = typeof value === "string" ? value : isNode(value) && typeof value["#text"] === "string" ? value["#text"] : "";
  const decoded = decodeEntities(text).trim();
  return decoded === "" ? null : decoded;
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return Array.from(text).slice(0, maxChars).join("");
}

/** Memotong ke paling banyak `maxBytes` byte UTF-8 tanpa pernah memecah satu code point. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    // Codepoint ini dikodekan 1-4 byte; surrogate tunggal dikodekan sebagai U+FFFD (3 byte).
    const codePoint = char.codePointAt(0) ?? 0;
    const size = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
}

function parseDurationMs(raw: string | null): number {
  if (raw === null || !DURATION.test(raw)) return 0;
  const ms = Math.round(Number(raw) * 1000);
  return Number.isSafeInteger(ms) ? ms : 0;
}

/** Elemen <failure>/<error> yang hanya berisi teks di-parse sebagai string, bukan node. */
function failureMessage(first: unknown): string | null {
  const message = (isNode(first) ? attr(first, "message") : null) ?? elementText(first);
  return message === null ? null : truncateUtf8(message, MAX_MESSAGE_BYTES);
}

function readOccurrence(testcase: XmlNode): Occurrence {
  const failures = [...asList(testcase["failure"]), ...asList(testcase["error"])];
  const durationMs = parseDurationMs(attr(testcase, "time"));
  if (failures.length > 0) {
    return { status: "failed", surefireRetries: 0, durationMs, message: failureMessage(failures[0]) };
  }
  if (testcase["skipped"] !== undefined) {
    return { status: "skipped", surefireRetries: 0, durationMs, message: null };
  }
  const surefireRetries = asNodes(testcase["flakyFailure"]).length + asNodes(testcase["rerunFailure"]).length;
  return { status: "passed", surefireRetries, durationMs, message: null };
}

function merge(suite: string, name: string, occurrences: Occurrence[]): ParsedResult {
  const hasPassed = occurrences.some((o) => o.status === "passed");
  const hasFailed = occurrences.some((o) => o.status === "failed");
  const status: ResultStatus = hasPassed ? "passed" : hasFailed ? "failed" : "skipped";
  const surefireRetries = occurrences.reduce((sum, o) => sum + o.surefireRetries, 0);
  const lastFailure = occurrences.findLast((o) => o.status === "failed");

  return {
    suite,
    name,
    status,
    flakyInRun: (hasPassed && hasFailed) || surefireRetries > 0,
    retries: occurrences.length - 1 + surefireRetries,
    durationMs: occurrences.reduce((sum, o) => sum + o.durationMs, 0),
    message: lastFailure?.message ?? null,
  };
}

function rootNode(doc: unknown): { tag: "testsuites" | "testsuite"; node: XmlNode } {
  const tags = isNode(doc) ? Object.keys(doc).filter((key) => !key.startsWith("?") && key !== "#comment") : [];
  const tag = tags[0];
  if (tags.length !== 1 || (tag !== "testsuites" && tag !== "testsuite")) {
    throw new InvalidReportError("Root elemen harus <testsuites> atau <testsuite>");
  }
  const [node] = asNodes((doc as XmlNode)[tag]);
  return { tag, node: node ?? {} };
}

export function parseJUnit(xml: string): ParsedReport {
  const source = xml.replace(/^﻿/, "").trimStart();

  // Cek pada string mentah sebelum parsing: tidak ada DOCTYPE/entity yang pernah sampai ke parser.
  if (DOCTYPE.test(source)) throw new InvalidReportError("DOCTYPE tidak diizinkan");

  const validation = XMLValidator.validate(source);
  if (validation !== true) throw new InvalidReportError("XML tidak valid");

  let doc: unknown;
  try {
    doc = parser.parse(source);
  } catch {
    throw new InvalidReportError("XML tidak valid");
  }

  const { tag, node: root } = rootNode(doc);

  const groups = new Map<string, { suite: string; name: string; occurrences: Occurrence[] }>();
  let testcaseCount = 0;

  const walk = (suiteNode: XmlNode, inheritedName: string): void => {
    const suiteName = attr(suiteNode, "name") ?? inheritedName;
    for (const testcase of asNodes(suiteNode["testcase"])) {
      testcaseCount += 1;
      if (testcaseCount > MAX_TESTCASES) throw new InvalidReportError(`Laporan memuat lebih dari ${MAX_TESTCASES} testcase`);

      const suite = truncateChars(attr(testcase, "classname") ?? suiteName, MAX_NAME_LENGTH);
      const name = truncateChars(attr(testcase, "name") ?? "", MAX_NAME_LENGTH);
      const key = `${suite}\u0000${name}`;
      const group = groups.get(key) ?? { suite, name, occurrences: [] };
      group.occurrences.push(readOccurrence(testcase));
      groups.set(key, group);
    }
    for (const child of asNodes(suiteNode["testsuite"])) walk(child, suiteName);
  };

  if (tag === "testsuite") walk(root, "");
  else for (const child of asNodes(root["testsuite"])) walk(child, "");

  if (testcaseCount === 0) throw new InvalidReportError("Laporan tidak memuat testcase");

  const results = [...groups.values()].map((g) => merge(g.suite, g.name, g.occurrences));
  const summedMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const rootTime = attr(root, "time");
  const durationMs = rootTime !== null && DURATION.test(rootTime) ? parseDurationMs(rootTime) : summedMs;

  return { durationMs, results };
}
