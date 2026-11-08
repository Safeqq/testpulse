import type { ManualCaseDto, ProjectDto, SuiteDto } from "@testpulse/shared";
import type { TestApi, TestUser } from "./api-client.js";

/** Helper data uji untuk spec test manual (suite, case, run): menyiapkan project berisi suite dan case lewat API. */

export interface ManualSeed {
  owner: TestUser;
  project: ProjectDto;
  suites: SuiteDto[];
  /** Semua case, urut pembuatan (nomor TC-1, TC-2, ...); case suite pertama lebih dulu. */
  cases: ManualCaseDto[];
}

export interface ManualSeedOptions {
  /** Jumlah suite (bernama "Suite 1", "Suite 2", ...) atau daftar nama suite. */
  suites: number | string[];
  /** Case aktif per suite (judul "Case <suite>.<n>"), dibuat berurutan agar nomornya bisa diprediksi. */
  casesPerSuite: number;
  visibility?: "public";
}

function suiteNames(suites: ManualSeedOptions["suites"]): string[] {
  return typeof suites === "number" ? Array.from({ length: suites }, (_, i) => `Suite ${i + 1}`) : suites;
}

/** Project baru (pemilik = admin) dengan `suites` suite masing-masing berisi `casesPerSuite` case aktif. */
export async function seedManualProject(api: TestApi, options: ManualSeedOptions): Promise<ManualSeed> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (options.visibility) await api.setVisibility(owner, project.slug, options.visibility);

  const suites: SuiteDto[] = [];
  for (const name of suiteNames(options.suites)) suites.push(await api.createSuite(owner, project.slug, { name }));

  const cases: ManualCaseDto[] = [];
  for (const [index, suite] of suites.entries()) {
    for (let n = 1; n <= options.casesPerSuite; n += 1) {
      cases.push(
        await api.createCase(owner, project.slug, {
          suiteId: suite.id,
          title: `Case ${index + 1}.${n}`,
          steps: [{ action: "Buka halaman", expected: "Halaman tampil" }],
        }),
      );
    }
  }
  return { owner, project, suites, cases };
}
