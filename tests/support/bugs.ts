import type { BrowserContextOptions, Page } from "@playwright/test";
import type {
  ActivityPageDto,
  BugDto,
  CreateBugBody,
  ProjectDto,
  RunDetailDto,
} from "@testpulse/shared";
import type { TestApi, TestUser } from "./api-client.js";
import { expect } from "./fixtures.js";
import { buildJUnit, type JUnitCase } from "./junit.js";

export const COMMIT = "abcdef1234567890abcdef1234567890abcdef12";
export const CI_URL = "https://ci.example.com/builds/42";

/** Helper data uji untuk spec bug (daftar, formulir, detail): project, bug, run, dan pembacaan JSON API. */

export async function newProject(
  api: TestApi,
  visibility?: "public",
): Promise<{ owner: TestUser; project: ProjectDto }> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (visibility) await api.setVisibility(owner, project.slug, visibility);
  return { owner, project };
}

/** Bug dibuat berurutan agar nomornya (1, 2, ...) bisa diprediksi. */
export async function createBugs(api: TestApi, owner: TestUser, slug: string, bugs: CreateBugBody[]): Promise<void> {
  for (const body of bugs) await api.createBug(owner, slug, body);
}

export async function uploadRun(api: TestApi, owner: TestUser, slug: string, cases: JUnitCase[]): Promise<string> {
  const { token } = await api.createToken(owner, slug);
  const res = await api.uploadRun(token, slug, buildJUnit(cases), {
    branch: "main",
    commit: COMMIT,
    ciUrl: CI_URL,
    name: "Build #42",
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

export async function testCaseIds(owner: TestUser, slug: string, runId: string): Promise<Record<string, string>> {
  const res = await owner.request.get(`/api/v1/projects/${slug}/runs/${runId}?status=all`);
  expect(res.status()).toBe(200);
  const detail = (await res.json()) as RunDetailDto;
  return Object.fromEntries(detail.results.map((r) => [r.name, r.testCaseId]));
}

/** Run pertama berisi test gagal "G gagal" dan test flaky "F flaky"; mengembalikan id run dan id test-nya. */
export async function failingRun(api: TestApi, owner: TestUser, slug: string) {
  const runId = await uploadRun(api, owner, slug, [
    { suite: "checkout", name: "G gagal", status: "failed", message: "boom" },
    { suite: "checkout", name: "F flaky", retries: 1, message: "percobaan pertama gagal" },
  ]);
  return { runId, ids: await testCaseIds(owner, slug, runId) };
}

/** Bug terkini menurut server (bukan menurut UI). */
export async function fetchBug(user: TestUser, slug: string, number: number): Promise<BugDto> {
  const res = await user.request.get(`/api/v1/projects/${slug}/bugs/${number}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as BugDto;
}

/** Halaman pertama aktivitas bug menurut server. */
export async function fetchActivity(user: TestUser, slug: string, number: number): Promise<ActivityPageDto> {
  const res = await user.request.get(`/api/v1/projects/${slug}/bugs/${number}/activity`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as ActivityPageDto;
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Opsi context 375 px yang sudah masuk sebagai `user` (untuk `newContext(...)`). */
export async function mobileContextOptions(user: TestUser): Promise<BrowserContextOptions> {
  return { storageState: await user.request.storageState(), viewport: { width: 375, height: 800 } };
}
