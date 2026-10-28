import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ResultStatus } from "@testpulse/shared";

export const MAX_TESTCASES = 20000;
export const MAX_NAME_LENGTH = 500;
export const MAX_MESSAGE_BYTES = 4096;
/** Kedalaman maksimum <testsuite> bersarang; melindungi rekursi dari dokumen yang sengaja sangat dalam. */
export const MAX_SUITE_DEPTH = 100;
/** Batas int4 PostgreSQL: durasi tidak boleh melebihinya agar penyimpanan tidak gagal. */
export const MAX_DURATION_MS = 2_147_483_647;

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
  /** Jumlah <flakyFailure>/<flakyError>/<rerunFailure> pada testcase yang lulus (konvensi Surefire). */
  surefireRetries: number;
  durationMs: number;
  message: string | null;
}

const ARRAY_TAGS = new Set(["testsuite", "testcase", "failure", "error", "skipped", "flakyFailure", "flakyError", "rerunFailure"]);
const CDATA_KEY = "__cdata";

// Entity tidak di-resolve oleh parser (processEntities: false); hanya entity standar XML dan
// referensi karakter yang didekode di sini, dalam satu lintasan sehingga tidak ada ekspansi berantai.
const parser = new XMLParser({
  processEntities: false,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // CDATA dipisahkan dari teks biasa agar isinya tidak ikut didekode entity-nya (CDATA bersifat literal).
  cdataPropName: CDATA_KEY,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

const DOCTYPE = /<!doctype/i;
/**
 * Karakter mentah di luar production `Char` XML 1.0 (mis. U+0000, U+0001, U+FFFE, surrogate tunggal). Dokumen yang
 * memuatnya tidak well-formed; tanpa cek ini NUL lolos ke nama/pesan dan ditolak Postgres (500). Flag `u` membuat
 * surrogate tunggal dinilai sebagai code point D800–DFFF (tidak ada di himpunan), sedangkan pasangan sah lolos.
 */
const NON_XML_CHAR = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;
const DURATION = /^(?:\d+\.?\d*|\.\d+)$/;
const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Production `Char` XML 1.0: referensi karakter di luar himpunan ini dibiarkan literal. */
function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g, (match, hex?: string, dec?: string, named?: string) => {
    if (named) return NAMED_ENTITIES[named] ?? match;
    const codePoint = hex ? parseInt(hex, 16) : parseInt(dec ?? "", 10);
    return isXmlChar(codePoint) ? String.fromCodePoint(codePoint) : match;
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
  if (typeof value === "string") {
    const text = decodeEntities(value).trim();
    return text === "" ? null : text;
  }
  if (!isNode(value)) return null;
  const plain = typeof value["#text"] === "string" ? decodeEntities(value["#text"]) : "";
  const cdata = asList(value[CDATA_KEY]).filter((part): part is string => typeof part === "string").join("");
  const text = (plain + cdata).trim();
  return text === "" ? null : text;
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

function clampMs(ms: number): number {
  return Math.min(MAX_DURATION_MS, ms);
}

function parseDurationMs(raw: string | null): number {
  if (raw === null || !DURATION.test(raw)) return 0;
  return clampMs(Math.round(Number(raw) * 1000));
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
  const surefireRetries =
    asList(testcase["flakyFailure"]).length + asList(testcase["flakyError"]).length + asList(testcase["rerunFailure"]).length;
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
    durationMs: clampMs(occurrences.reduce((sum, o) => sum + o.durationMs, 0)),
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
  const source = xml.replace(/^\uFEFF/, "").trimStart();

  // Cek pada string mentah sebelum parsing: tidak ada DOCTYPE/entity yang pernah sampai ke parser.
  if (DOCTYPE.test(source)) throw new InvalidReportError("DOCTYPE tidak diizinkan");
  if (NON_XML_CHAR.test(source)) throw new InvalidReportError("XML memuat karakter yang tidak diizinkan");

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

  const walk = (suiteNode: XmlNode, inheritedName: string, depth: number): void => {
    if (depth > MAX_SUITE_DEPTH) throw new InvalidReportError(`Testsuite bersarang lebih dari ${MAX_SUITE_DEPTH} tingkat`);
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
    for (const child of asNodes(suiteNode["testsuite"])) walk(child, suiteName, depth + 1);
  };

  if (tag === "testsuite") walk(root, "", 1);
  else for (const child of asNodes(root["testsuite"])) walk(child, "", 1);

  if (testcaseCount === 0) throw new InvalidReportError("Laporan tidak memuat testcase");

  const results = [...groups.values()].map((g) => merge(g.suite, g.name, g.occurrences));
  const summedMs = clampMs(results.reduce((sum, r) => sum + r.durationMs, 0));
  const rootTime = attr(root, "time");
  const durationMs = rootTime !== null && DURATION.test(rootTime) ? parseDurationMs(rootTime) : summedMs;

  return { durationMs, results };
}
