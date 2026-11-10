import { request as playwrightRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import type {
  AcceptInvitationDto,
  BugDto,
  CommentBody,
  CommentDto,
  CreateBugBody,
  CreateCaseBody,
  CreateManualRunBody,
  CreateProjectBody,
  CreatedInvitationDto,
  CreatedTokenDto,
  InvitableRole,
  ManualCaseDto,
  ManualRunDto,
  ProjectDto,
  RegisterBody,
  Role,
  RunCaseDto,
  RunCaseListItemDto,
  RunCasesPageDto,
  SuiteBody,
  SuiteDto,
  UpdateBugBody,
  UpdateCaseBody,
  UpdateRunCaseBody,
  UserDto,
  Visibility,
} from "@testpulse/shared";
import { newProjectData, newUserData } from "./data.js";

const API = "/api/v1";

/** Isi buat run manual; `suiteIds`/`caseNumbers` yang tidak dikirim dianggap kosong oleh server. */
export type CreateManualRunInput = Omit<CreateManualRunBody, "suiteIds" | "caseNumbers"> &
  Partial<Pick<CreateManualRunBody, "suiteIds" | "caseNumbers">>;

/** Satu `APIRequestContext` per user agar cookie sesi tiap user terpisah. */
export interface TestUser {
  user: UserDto;
  password: string;
  request: APIRequestContext;
}

async function expectStatus<T>(res: APIResponse, expected: number, what: string): Promise<T> {
  if (res.status() !== expected) {
    throw new Error(`${what}: diharapkan ${expected}, diterima ${res.status()} ${await res.text()}`);
  }
  return (expected === 204 ? undefined : await res.json()) as T;
}

/** Helper API untuk menyiapkan data test (bukan untuk menguji API itu sendiri). */
export class TestApi {
  private readonly contexts: APIRequestContext[] = [];

  constructor(private readonly baseURL: string) {}

  /** Context tanpa cookie sesi; `extraHTTPHeaders` (mis. `Authorization`) ikut di setiap request. */
  async anonymous(extraHTTPHeaders?: Record<string, string>): Promise<APIRequestContext> {
    const ctx = await playwrightRequest.newContext({
      baseURL: this.baseURL,
      ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
    });
    this.contexts.push(ctx);
    return ctx;
  }

  async register(data?: Partial<RegisterBody>): Promise<TestUser> {
    const body = { ...newUserData(), ...data };
    const request = await this.anonymous();
    const user = await expectStatus<UserDto>(await request.post(`${API}/auth/register`, { data: body }), 201, "register");
    return { user, password: body.password, request };
  }

  async createProject(owner: TestUser, data?: Partial<CreateProjectBody>): Promise<ProjectDto> {
    const body = { ...newProjectData(), ...data };
    return expectStatus<ProjectDto>(await owner.request.post(`${API}/projects`, { data: body }), 201, "createProject");
  }

  async setVisibility(owner: TestUser, slug: string, visibility: Visibility): Promise<void> {
    await expectStatus(await owner.request.patch(`${API}/projects/${slug}`, { data: { visibility } }), 200, "setVisibility");
  }

  async createInvitation(owner: TestUser, slug: string, role: InvitableRole): Promise<CreatedInvitationDto> {
    return expectStatus<CreatedInvitationDto>(
      await owner.request.post(`${API}/projects/${slug}/invitations`, { data: { role } }),
      201,
      "createInvitation",
    );
  }

  async acceptInvitation(user: TestUser, token: string): Promise<AcceptInvitationDto> {
    return expectStatus<AcceptInvitationDto>(
      await user.request.post(`${API}/invitations/${token}/accept`),
      200,
      "acceptInvitation",
    );
  }

  async createToken(owner: TestUser, slug: string, name = "CI e2e"): Promise<CreatedTokenDto> {
    return expectStatus<CreatedTokenDto>(
      await owner.request.post(`${API}/projects/${slug}/tokens`, { data: { name } }),
      201,
      "createToken",
    );
  }

  /** Unggah laporan JUnit XML dengan token CI (tanpa cookie sesi); mengembalikan respons mentah agar test bisa memeriksa status. */
  async uploadRun(
    token: string,
    slug: string,
    xml: string,
    query: { branch: string; commit?: string; ciUrl?: string; name?: string; version?: string },
  ): Promise<APIResponse> {
    const params = new URLSearchParams({ branch: query.branch });
    if (query.commit !== undefined) params.set("commit", query.commit);
    if (query.ciUrl !== undefined) params.set("ciUrl", query.ciUrl);
    if (query.name !== undefined) params.set("name", query.name);
    if (query.version !== undefined) params.set("version", query.version);
    return (await this.anonymous()).post(`${API}/projects/${slug}/runs?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}`, "content-type": "application/xml" },
      data: xml,
    });
  }

  /** Buat bug sebagai `user` (tester/admin); mengembalikan bug dengan `number` dari server. */
  async createBug(user: TestUser, slug: string, body: CreateBugBody): Promise<BugDto> {
    return expectStatus<BugDto>(await user.request.post(`${API}/projects/${slug}/bugs`, { data: body }), 201, "createBug");
  }

  /** Ubah bug; `body.version` harus versi terakhir bug itu (mulai 1, naik tiap perubahan). */
  async updateBug(user: TestUser, slug: string, number: number, body: UpdateBugBody): Promise<BugDto> {
    return expectStatus<BugDto>(
      await user.request.patch(`${API}/projects/${slug}/bugs/${number}`, { data: body }),
      200,
      "updateBug",
    );
  }

  async addComment(user: TestUser, slug: string, number: number, body: CommentBody): Promise<CommentDto> {
    return expectStatus<CommentDto>(
      await user.request.post(`${API}/projects/${slug}/bugs/${number}/comments`, { data: body }),
      201,
      "addComment",
    );
  }

  /** Buat suite test manual sebagai `user` (tester/admin); suite baru berada di posisi terakhir. */
  async createSuite(user: TestUser, slug: string, body: SuiteBody): Promise<SuiteDto> {
    return expectStatus<SuiteDto>(await user.request.post(`${API}/projects/${slug}/suites`, { data: body }), 201, "createSuite");
  }

  /** Buat test case manual; `number` (TC-n) dialokasikan server. */
  async createCase(user: TestUser, slug: string, body: CreateCaseBody): Promise<ManualCaseDto> {
    return expectStatus<ManualCaseDto>(await user.request.post(`${API}/projects/${slug}/cases`, { data: body }), 201, "createCase");
  }

  /** Ubah case; `body.version` harus versi terakhir case itu (mulai 1, naik tiap perubahan). */
  async updateCase(user: TestUser, slug: string, number: number, body: UpdateCaseBody): Promise<ManualCaseDto> {
    return expectStatus<ManualCaseDto>(
      await user.request.patch(`${API}/projects/${slug}/cases/${number}`, { data: body }),
      200,
      "updateCase",
    );
  }

  /** Buat run manual dari suite dan/atau nomor case; case disalin sebagai snapshot saat run dibuat. */
  async createManualRun(user: TestUser, slug: string, body: CreateManualRunInput): Promise<ManualRunDto> {
    return expectStatus<ManualRunDto>(
      await user.request.post(`${API}/projects/${slug}/manual-runs`, { data: body }),
      201,
      "createManualRun",
    );
  }

  /** Isi hasil satu run case; `body.version` harus versi terakhir run case itu. */
  async updateRunCase(
    user: TestUser,
    slug: string,
    runNumber: number,
    id: string,
    body: UpdateRunCaseBody,
  ): Promise<RunCaseDto> {
    return expectStatus<RunCaseDto>(
      await user.request.patch(`${API}/projects/${slug}/manual-runs/${runNumber}/cases/${id}`, { data: body }),
      200,
      "updateRunCase",
    );
  }

  /** Run case halaman pertama (urut posisi) sebuah run manual; cukup untuk run kecil. */
  async listRunCases(user: TestUser, slug: string, runNumber: number): Promise<RunCaseListItemDto[]> {
    const page = await expectStatus<RunCasesPageDto>(
      await user.request.get(`${API}/projects/${slug}/manual-runs/${runNumber}/cases`),
      200,
      "listRunCases",
    );
    return page.items;
  }

  /** Daftarkan user baru, undang, terima; role `admin` dicapai dengan mengubah role setelah bergabung. */
  async addMember(owner: TestUser, slug: string, role: Role): Promise<TestUser> {
    const member = await this.register();
    const invitation = await this.createInvitation(owner, slug, role === "admin" ? "tester" : role);
    const token = invitation.url.slice(invitation.url.lastIndexOf("/") + 1);
    await this.acceptInvitation(member, token);
    if (role === "admin") {
      await expectStatus(
        await owner.request.patch(`${API}/projects/${slug}/members/${member.user.id}`, { data: { role: "admin" } }),
        200,
        "promote member",
      );
    }
    return member;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.contexts.splice(0).map((ctx) => ctx.dispose()));
  }
}
