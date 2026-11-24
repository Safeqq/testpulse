import type { CreateCrowdReportBody, CreateCycleBody, ProjectDto, TeamCycleDto } from "@testpulse/shared";
import type { TestApi, TestUser } from "./api-client.js";

/** Helper data uji crowdtesting: project tim dengan cycle dan crowd tester di luar tim. */

export interface CrowdSeed {
  owner: TestUser;
  project: ProjectDto;
  cycles: TeamCycleDto[];
}

export const cycleBody = (over: Partial<CreateCycleBody> = {}): CreateCycleBody => ({
  title: "Uji rilis",
  summary: "Coba alur utama dan laporkan bug yang Anda temukan.",
  links: [{ url: "https://app.example.com", label: "Aplikasi web" }],
  instructions: "1. Daftar akun\n2. Coba **checkout**",
  inScope: "Login dan checkout",
  outOfScope: "Serangan DoS",
  environments: ["Chrome desktop", "Android"],
  ...over,
});

export const crowdReportBody = (over: Partial<CreateCrowdReportBody> = {}): CreateCrowdReportBody => ({
  title: "Tombol simpan error",
  steps: "1. Buka form\n2. Klik **Simpan**",
  expected: "Data tersimpan",
  actual: "Muncul error 500",
  environment: "Chrome 130 / Windows 11",
  suggestedSeverity: "major",
  ...over,
});

/** Project baru (pemilik = admin) dengan cycle terbuka berjudul `titles` (default satu cycle). */
export async function seedCrowd(
  api: TestApi,
  options: { titles?: string[]; visibility?: "public"; cycle?: Partial<CreateCycleBody> } = {},
): Promise<CrowdSeed> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (options.visibility) await api.setVisibility(owner, project.slug, options.visibility);
  const cycles: TeamCycleDto[] = [];
  for (const title of options.titles ?? ["Uji rilis"]) {
    cycles.push(await api.createOpenCycle(owner, project.slug, cycleBody({ title, ...options.cycle })));
  }
  return { owner, project, cycles };
}

/** Crowd tester baru yang sudah ikut `cycle`. */
export async function joinedTester(api: TestApi, cycle: TeamCycleDto): Promise<TestUser> {
  const tester = await api.register();
  await api.joinCycle(tester, cycle.id);
  return tester;
}

/** Laporan dari `tester` yang langsung diterima tim dengan `severity` (poin 1/3/5/8). */
export async function acceptedReport(
  api: TestApi,
  seed: CrowdSeed,
  cycle: TeamCycleDto,
  tester: TestUser,
  severity: "minor" | "major" | "critical" | "blocker" = "major",
  title = "Laporan diterima",
) {
  const report = await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title, suggestedSeverity: severity }));
  return api.triage(seed.owner, seed.project.slug, report.number, { version: report.version, decision: "accept", severity });
}
