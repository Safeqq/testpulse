import type {
  AcceptInvitationDto,
  ActivityPageDto,
  ApiErrorBody,
  BranchDto,
  BugDto,
  BugListQuery,
  BugsPageDto,
  CommentBody,
  CommentDto,
  CompareDto,
  CompareGroup,
  CompareGroupPageDto,
  CompareQuery,
  CasesPageDto,
  CaseListQuery,
  CreateCaseBody,
  CreateManualRunBody,
  CreateBugBody,
  CreateInvitationBody,
  CreateProjectBody,
  CreatedInvitationDto,
  CreatedTokenDto,
  DeleteProjectBody,
  ErrorCode,
  FlakyTestDto,
  InvitationDto,
  InvitationPreviewDto,
  LoginBody,
  ManualCaseDto,
  ManualRunDto,
  ManualRunListQuery,
  ManualRunsPageDto,
  ManualSummaryDto,
  MemberDto,
  ProjectDto,
  RegisterBody,
  RunCaseDto,
  RunCaseListQuery,
  RunCasesPageDto,
  RunDetailDto,
  RunsPageDto,
  StatsDto,
  SuiteBody,
  SuiteDto,
  TestHistoryDto,
  TestSearchItemDto,
  TokenDto,
  UpdateBugBody,
  UpdateCaseBody,
  UpdateManualRunBody,
  UpdateMemberBody,
  UpdateProjectBody,
  UpdateRunCaseBody,
  UpdateSuiteBody,
  UserDto,
  VersionDto,
  CreateCrowdReportBody,
  CreateCycleBody,
  CrowdCommentBody,
  CrowdCommentDto,
  CrowdCommentsPageDto,
  CrowdDirectoryQuery,
  CrowdMeDto,
  CrowdReportDto,
  CrowdReportsPageDto,
  CrowdSummaryDto,
  CycleDirectoryPageDto,
  HideBody,
  KnownIssuesPageDto,
  LeaderboardDto,
  MyCrowdReportsDto,
  ParticipantsPageDto,
  ParticipantsQuery,
  PublicCycleDto,
  RemoveParticipantBody,
  TeamCrowdReportDto,
  TeamCycleDto,
  TeamCyclesPageDto,
  TeamCyclesQuery,
  TeamReportsQuery,
  TesterProfileDto,
  TriageBody,
  UpdateCrowdReportBody,
  UpdateCycleBody,
} from "@testpulse/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

const GENERIC_ERROR = "Terjadi kesalahan pada server. Coba lagi nanti.";
const NETWORK_ERROR = "Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.";

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Menambahkan query string yang di-encode; nilai undefined atau kosong dibuang (server menolak `?branch=` kosong dengan 400). */
function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text === "" ? path : `${path}?${text}`;
}

/** Isi buat run manual: server mengisi `suiteIds`/`caseNumbers` yang tidak dikirim dengan daftar kosong. */
export type CreateManualRunInput = Omit<CreateManualRunBody, "suiteIds" | "caseNumbers"> &
  Partial<Pick<CreateManualRunBody, "suiteIds" | "caseNumbers">>;

/** Pasangan run yang dibandingkan; kosong = default server (spec Tahap 3 §4.3). */
export type CompareParams = Pick<CompareQuery, "base" | "target" | "branch" | "groups">;

/**
 * Halaman berikutnya satu kelompok perbandingan. `cursor` terikat pada pasangan run, jadi `base` dan `target` harus
 * id run dari respons pertama (bukan default yang bisa bergeser setelah upload baru).
 */
export type CompareGroupParams = CompareParams & { base: string; target: string; group: CompareGroup; cursor: string };

export function createApiClient(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, credentials: "include" };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetchFn(`${base}/v1${path}`, init);
    } catch {
      throw new ApiError(0, "INTERNAL_ERROR", NETWORK_ERROR);
    }

    const payload = await parseBody(res);
    if (!res.ok) {
      if (isApiErrorBody(payload)) {
        const { code, message, fields } = payload.error;
        throw new ApiError(res.status, code, message, fields);
      }
      throw new ApiError(res.status, "INTERNAL_ERROR", GENERIC_ERROR);
    }
    return payload as T;
  }

  const seg = encodeURIComponent;

  return {
    auth: {
      register: (body: RegisterBody) => request<UserDto>("POST", "/auth/register", body),
      login: (body: LoginBody) => request<UserDto>("POST", "/auth/login", body),
      logout: () => request<void>("POST", "/auth/logout"),
      me: () => request<UserDto>("GET", "/auth/me"),
    },
    projects: {
      list: () => request<ProjectDto[]>("GET", "/projects"),
      create: (body: CreateProjectBody) => request<ProjectDto>("POST", "/projects", body),
      get: (slug: string) => request<ProjectDto>("GET", `/projects/${seg(slug)}`),
      update: (slug: string, body: UpdateProjectBody) => request<ProjectDto>("PATCH", `/projects/${seg(slug)}`, body),
      remove: (slug: string, body: DeleteProjectBody) => request<void>("DELETE", `/projects/${seg(slug)}`, body),
    },
    members: {
      list: (slug: string) => request<MemberDto[]>("GET", `/projects/${seg(slug)}/members`),
      updateRole: (slug: string, userId: string, body: UpdateMemberBody) =>
        request<MemberDto>("PATCH", `/projects/${seg(slug)}/members/${seg(userId)}`, body),
      remove: (slug: string, userId: string) => request<void>("DELETE", `/projects/${seg(slug)}/members/${seg(userId)}`),
    },
    invitations: {
      list: (slug: string) => request<InvitationDto[]>("GET", `/projects/${seg(slug)}/invitations`),
      create: (slug: string, body: CreateInvitationBody) =>
        request<CreatedInvitationDto>("POST", `/projects/${seg(slug)}/invitations`, body),
      revoke: (slug: string, id: string) => request<void>("DELETE", `/projects/${seg(slug)}/invitations/${seg(id)}`),
      preview: (token: string) => request<InvitationPreviewDto>("GET", `/invitations/${seg(token)}`),
      accept: (token: string) => request<AcceptInvitationDto>("POST", `/invitations/${seg(token)}/accept`),
    },
    results: {
      branches: (slug: string) => request<BranchDto[]>("GET", `/projects/${seg(slug)}/branches`),
      runs: (slug: string, query: { branch?: string; cursor?: string } = {}) =>
        request<RunsPageDto>("GET", withQuery(`/projects/${seg(slug)}/runs`, query)),
      run: (slug: string, runId: string, query: { status?: "failed" | "flaky" | "all"; cursor?: string } = {}) =>
        request<RunDetailDto>("GET", withQuery(`/projects/${seg(slug)}/runs/${seg(runId)}`, query)),
      deleteRun: (slug: string, runId: string) => request<void>("DELETE", `/projects/${seg(slug)}/runs/${seg(runId)}`),
      stats: (slug: string, branch?: string) =>
        request<StatsDto>("GET", withQuery(`/projects/${seg(slug)}/stats`, { branch })),
      flaky: (slug: string, branch?: string) =>
        request<FlakyTestDto[]>("GET", withQuery(`/projects/${seg(slug)}/flaky`, { branch })),
      history: (slug: string, testCaseId: string, branch?: string) =>
        request<TestHistoryDto>("GET", withQuery(`/projects/${seg(slug)}/tests/${seg(testCaseId)}/history`, { branch })),
      versions: (slug: string, branch?: string) =>
        request<VersionDto[]>("GET", withQuery(`/projects/${seg(slug)}/versions`, { branch })),
      compare: (slug: string, params: CompareParams = {}) =>
        request<CompareDto>("GET", withQuery(`/projects/${seg(slug)}/compare`, params)),
      compareGroup: (slug: string, params: CompareGroupParams) =>
        request<CompareGroupPageDto>("GET", withQuery(`/projects/${seg(slug)}/compare`, params)),
    },
    bugs: {
      list: (slug: string, query: Partial<BugListQuery> = {}) =>
        request<BugsPageDto>("GET", withQuery(`/projects/${seg(slug)}/bugs`, query)),
      labels: (slug: string) => request<string[]>("GET", `/projects/${seg(slug)}/bugs/labels`),
      get: (slug: string, number: number) => request<BugDto>("GET", `/projects/${seg(slug)}/bugs/${number}`),
      create: (slug: string, body: CreateBugBody) => request<BugDto>("POST", `/projects/${seg(slug)}/bugs`, body),
      update: (slug: string, number: number, body: UpdateBugBody) =>
        request<BugDto>("PATCH", `/projects/${seg(slug)}/bugs/${number}`, body),
      remove: (slug: string, number: number) => request<void>("DELETE", `/projects/${seg(slug)}/bugs/${number}`),
      activity: (slug: string, number: number, cursor?: string) =>
        request<ActivityPageDto>("GET", withQuery(`/projects/${seg(slug)}/bugs/${number}/activity`, { cursor })),
    },
    manual: {
      suites: {
        list: (slug: string) => request<SuiteDto[]>("GET", `/projects/${seg(slug)}/suites`),
        create: (slug: string, body: SuiteBody) => request<SuiteDto>("POST", `/projects/${seg(slug)}/suites`, body),
        update: (slug: string, id: string, body: UpdateSuiteBody) =>
          request<SuiteDto>("PATCH", `/projects/${seg(slug)}/suites/${seg(id)}`, body),
        remove: (slug: string, id: string) => request<void>("DELETE", `/projects/${seg(slug)}/suites/${seg(id)}`),
      },
      cases: {
        list: (slug: string, query: Partial<CaseListQuery> = {}) =>
          request<CasesPageDto>("GET", withQuery(`/projects/${seg(slug)}/cases`, query)),
        labels: (slug: string) => request<string[]>("GET", `/projects/${seg(slug)}/cases/labels`),
        get: (slug: string, number: number) => request<ManualCaseDto>("GET", `/projects/${seg(slug)}/cases/${number}`),
        create: (slug: string, body: CreateCaseBody) =>
          request<ManualCaseDto>("POST", `/projects/${seg(slug)}/cases`, body),
        update: (slug: string, number: number, body: UpdateCaseBody) =>
          request<ManualCaseDto>("PATCH", `/projects/${seg(slug)}/cases/${number}`, body),
        remove: (slug: string, number: number) => request<void>("DELETE", `/projects/${seg(slug)}/cases/${number}`),
      },
      searchTests: (slug: string, q: string) =>
        request<TestSearchItemDto[]>("GET", withQuery(`/projects/${seg(slug)}/tests`, { q })),
      runs: {
        list: (slug: string, query: Partial<ManualRunListQuery> = {}) =>
          request<ManualRunsPageDto>("GET", withQuery(`/projects/${seg(slug)}/manual-runs`, query)),
        get: (slug: string, number: number) =>
          request<ManualRunDto>("GET", `/projects/${seg(slug)}/manual-runs/${number}`),
        create: (slug: string, body: CreateManualRunInput) =>
          request<ManualRunDto>("POST", `/projects/${seg(slug)}/manual-runs`, body),
        update: (slug: string, number: number, body: UpdateManualRunBody) =>
          request<ManualRunDto>("PATCH", `/projects/${seg(slug)}/manual-runs/${number}`, body),
        remove: (slug: string, number: number) =>
          request<void>("DELETE", `/projects/${seg(slug)}/manual-runs/${number}`),
      },
      runCases: {
        list: (slug: string, runNumber: number, query: Partial<RunCaseListQuery> = {}) =>
          request<RunCasesPageDto>("GET", withQuery(`/projects/${seg(slug)}/manual-runs/${runNumber}/cases`, query)),
        get: (slug: string, runNumber: number, id: string) =>
          request<RunCaseDto>("GET", `/projects/${seg(slug)}/manual-runs/${runNumber}/cases/${seg(id)}`),
        update: (slug: string, runNumber: number, id: string, body: UpdateRunCaseBody) =>
          request<RunCaseDto>("PATCH", `/projects/${seg(slug)}/manual-runs/${runNumber}/cases/${seg(id)}`, body),
      },
      summary: (slug: string) => request<ManualSummaryDto>("GET", `/projects/${seg(slug)}/manual/summary`),
    },
    crowd: {
      directory: (query: Partial<CrowdDirectoryQuery> = {}) =>
        request<CycleDirectoryPageDto>("GET", withQuery("/crowd/cycles", query)),
      cycle: (id: string) => request<PublicCycleDto>("GET", `/crowd/cycles/${seg(id)}`),
      join: (id: string) =>
        request<PublicCycleDto["me"]>("POST", `/crowd/cycles/${seg(id)}/join`, { acceptRules: true }),
      leave: (id: string) => request<void>("DELETE", `/crowd/cycles/${seg(id)}/join`),
      knownIssues: (id: string, cursor?: string) =>
        request<KnownIssuesPageDto>("GET", withQuery(`/crowd/cycles/${seg(id)}/known-issues`, { cursor })),
      leaderboard: (id: string) => request<LeaderboardDto>("GET", `/crowd/cycles/${seg(id)}/leaderboard`),
      globalLeaderboard: () => request<LeaderboardDto>("GET", "/crowd/leaderboard"),
      tester: (userId: string) => request<TesterProfileDto>("GET", `/crowd/testers/${seg(userId)}`),
      me: () => request<CrowdMeDto>("GET", "/crowd/me"),
      myReports: (cycleId: string) => request<MyCrowdReportsDto>("GET", `/crowd/cycles/${seg(cycleId)}/reports`),
      submitReport: (cycleId: string, body: CreateCrowdReportBody) =>
        request<CrowdReportDto>("POST", `/crowd/cycles/${seg(cycleId)}/reports`, body),
      report: (id: string) => request<CrowdReportDto>("GET", `/crowd/reports/${seg(id)}`),
      updateReport: (id: string, body: UpdateCrowdReportBody) =>
        request<CrowdReportDto>("PATCH", `/crowd/reports/${seg(id)}`, body),
      withdrawReport: (id: string) => request<CrowdReportDto>("DELETE", `/crowd/reports/${seg(id)}`),
      comments: (id: string, cursor?: string) =>
        request<CrowdCommentsPageDto>("GET", withQuery(`/crowd/reports/${seg(id)}/comments`, { cursor })),
      addComment: (id: string, body: CrowdCommentBody) =>
        request<CrowdCommentDto>("POST", `/crowd/reports/${seg(id)}/comments`, body),
      deleteComment: (id: string, commentId: string) =>
        request<void>("DELETE", `/crowd/reports/${seg(id)}/comments/${seg(commentId)}`),
    },
    cycles: {
      list: (slug: string, query: Partial<TeamCyclesQuery> = {}) =>
        request<TeamCyclesPageDto>("GET", withQuery(`/projects/${seg(slug)}/cycles`, query)),
      get: (slug: string, number: number) => request<TeamCycleDto>("GET", `/projects/${seg(slug)}/cycles/${number}`),
      create: (slug: string, body: CreateCycleBody) => request<TeamCycleDto>("POST", `/projects/${seg(slug)}/cycles`, body),
      update: (slug: string, number: number, body: UpdateCycleBody) =>
        request<TeamCycleDto>("PATCH", `/projects/${seg(slug)}/cycles/${number}`, body),
      remove: (slug: string, number: number) => request<void>("DELETE", `/projects/${seg(slug)}/cycles/${number}`),
      participants: (slug: string, number: number, query: Partial<ParticipantsQuery> = {}) =>
        request<ParticipantsPageDto>("GET", withQuery(`/projects/${seg(slug)}/cycles/${number}/participants`, query)),
      removeParticipant: (slug: string, number: number, userId: string, body: RemoveParticipantBody = {}) =>
        request<void>("POST", `/projects/${seg(slug)}/cycles/${number}/participants/${seg(userId)}/remove`, body),
      reports: (slug: string, number: number, query: Partial<TeamReportsQuery> = {}) =>
        request<CrowdReportsPageDto>("GET", withQuery(`/projects/${seg(slug)}/cycles/${number}/reports`, query)),
      leaderboard: (slug: string, number: number) =>
        request<LeaderboardDto>("GET", `/projects/${seg(slug)}/cycles/${number}/leaderboard`),
      summary: (slug: string) => request<CrowdSummaryDto>("GET", `/projects/${seg(slug)}/crowd/summary`),
    },
    crowdReports: {
      get: (slug: string, number: number) =>
        request<TeamCrowdReportDto>("GET", `/projects/${seg(slug)}/crowd-reports/${number}`),
      triage: (slug: string, number: number, body: TriageBody) =>
        request<TeamCrowdReportDto>("POST", `/projects/${seg(slug)}/crowd-reports/${number}/triage`, body),
      setHidden: (slug: string, number: number, body: HideBody) =>
        request<TeamCrowdReportDto>("PATCH", `/projects/${seg(slug)}/crowd-reports/${number}`, body),
      comments: (slug: string, number: number, cursor?: string) =>
        request<CrowdCommentsPageDto>("GET", withQuery(`/projects/${seg(slug)}/crowd-reports/${number}/comments`, { cursor })),
      addComment: (slug: string, number: number, body: CrowdCommentBody) =>
        request<CrowdCommentDto>("POST", `/projects/${seg(slug)}/crowd-reports/${number}/comments`, body),
      deleteComment: (slug: string, number: number, id: string) =>
        request<void>("DELETE", `/projects/${seg(slug)}/crowd-reports/${number}/comments/${seg(id)}`),
    },
    comments: {
      create: (slug: string, number: number, body: CommentBody) =>
        request<CommentDto>("POST", `/projects/${seg(slug)}/bugs/${number}/comments`, body),
      update: (slug: string, number: number, id: string, body: CommentBody) =>
        request<CommentDto>("PATCH", `/projects/${seg(slug)}/bugs/${number}/comments/${seg(id)}`, body),
      remove: (slug: string, number: number, id: string) =>
        request<void>("DELETE", `/projects/${seg(slug)}/bugs/${number}/comments/${seg(id)}`),
    },
    tokens: {
      list: (slug: string) => request<TokenDto[]>("GET", `/projects/${seg(slug)}/tokens`),
      create: (slug: string, name: string) =>
        request<CreatedTokenDto>("POST", `/projects/${seg(slug)}/tokens`, { name }),
      revoke: (slug: string, id: string) => request<void>("DELETE", `/projects/${seg(slug)}/tokens/${seg(id)}`),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "/api");
