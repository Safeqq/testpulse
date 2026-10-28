import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import type { ReporterOptions } from "../../src/args.js";
import { mergeJUnit } from "../../src/merge.js";
import { UploadError, uploadReport } from "../../src/upload.js";
import { createPact, INGEST_TOKEN, PROJECT_SLUG, STATE, UNKNOWN_TOKEN } from "./pact.js";

const pact = createPact();
const { like, regex, uuid, integer } = MatchersV3;

const RUN_ID = "66666666-6666-4666-8666-666666666666";
const RUN_URL_PATTERN = /^https?:\/\/[^/]+\/p\/[a-z0-9-]+\/runs\/[0-9a-f-]{36}$/;

/** Laporan yang dikirim reporter sungguhan: dua file JUnit digabung menjadi satu `<testsuites>`. */
const REPORT = mergeJUnit([
  `<testsuites><testsuite name="a.test.ts"><testcase classname="a" name="satu" time="0.5"/><testcase classname="a" name="dua" time="0.1"/></testsuite></testsuites>`,
  `<testsuite name="b.test.ts"><testcase classname="b" name="tiga" time="0.2"/></testsuite>`,
]);

/**
 * Mock server Pact membandingkan body XML secara struktural dan menolak elemen tanpa aturan, bahkan untuk dokumen yang
 * identik; aturan `type` pada elemen akar menghindarinya. Provider memutar ulang body contoh apa adanya.
 */
const XML_RULES = { body: { path: "$.testsuites", rules: [like("")] } };
const REQUEST_BODY = Buffer.from(REPORT, "utf8");

const QUERY = { branch: "main", commit: "abc1234def", ciUrl: "https://ci.example.com/runs/1", name: "unit" };

function optionsFor(baseUrl: string, token: string): ReporterOptions {
  return { url: baseUrl, project: PROJECT_SLUG, files: [], token, ...QUERY };
}

describe("kontrak reporter -> POST /projects/:slug/runs", () => {
  it("upload laporan dengan token aktif -> 201 ingestResult", async () => {
    await pact
      .addInteraction()
      .given(STATE.activeToken)
      .uponReceiving("upload laporan JUnit dengan token CI aktif")
      .withRequest("POST", `/api/v1/projects/${PROJECT_SLUG}/runs`, (b) =>
        b
          .query(QUERY)
          .headers({ Authorization: `Bearer ${INGEST_TOKEN}` })
          .body("application/xml", REQUEST_BODY)
          .matchingRules(XML_RULES),
      )
      .willRespondWith(201, (b) =>
        b.jsonBody({
          runId: uuid(RUN_ID),
          url: regex(RUN_URL_PATTERN, `http://localhost:5173/p/${PROJECT_SLUG}/runs/${RUN_ID}`),
          totals: {
            total: integer(3),
            passed: integer(3),
            failed: integer(0),
            skipped: integer(0),
            flaky: integer(0),
          },
        }),
      )
      .executeTest(async (server) => {
        const result = await uploadReport(optionsFor(server.url, INGEST_TOKEN), REPORT);
        expect(result.runId).toBe(RUN_ID);
        expect(result.totals.total).toBe(3);
        expect(result.url).toMatch(RUN_URL_PATTERN);
      });
  });

  it("token tidak dikenal -> 401 UNAUTHENTICATED", async () => {
    await pact
      .addInteraction()
      .uponReceiving("upload laporan JUnit dengan token CI tidak dikenal")
      .withRequest("POST", `/api/v1/projects/${PROJECT_SLUG}/runs`, (b) =>
        b
          .query(QUERY)
          .headers({ Authorization: `Bearer ${UNKNOWN_TOKEN}` })
          .body("application/xml", REQUEST_BODY)
          .matchingRules(XML_RULES),
      )
      .willRespondWith(401, (b) =>
        b.jsonBody({ error: { code: "UNAUTHENTICATED", message: like("Token CI tidak valid") } }),
      )
      .executeTest(async (server) => {
        const err = await uploadReport(optionsFor(server.url, UNKNOWN_TOKEN), REPORT).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(UploadError);
        expect(err).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
        expect((err as UploadError).message).not.toContain(UNKNOWN_TOKEN);
      });
  });
});
