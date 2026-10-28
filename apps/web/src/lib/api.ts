import type {
  AcceptInvitationDto,
  ApiErrorBody,
  BranchDto,
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
  MemberDto,
  ProjectDto,
  RegisterBody,
  RunDetailDto,
  RunsPageDto,
  StatsDto,
  TestHistoryDto,
  TokenDto,
  UpdateMemberBody,
  UpdateProjectBody,
  UserDto,
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
