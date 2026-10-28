import { request as playwrightRequest, type APIRequestContext, type APIResponse } from "@playwright/test";
import type {
  AcceptInvitationDto,
  CreateProjectBody,
  CreatedInvitationDto,
  CreatedTokenDto,
  InvitableRole,
  ProjectDto,
  RegisterBody,
  Role,
  UserDto,
  Visibility,
} from "@testpulse/shared";
import { newProjectData, newUserData } from "./data.js";

const API = "/api/v1";

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
    query: { branch: string; commit?: string; ciUrl?: string; name?: string },
  ): Promise<APIResponse> {
    const params = new URLSearchParams({ branch: query.branch });
    if (query.commit !== undefined) params.set("commit", query.commit);
    if (query.ciUrl !== undefined) params.set("ciUrl", query.ciUrl);
    if (query.name !== undefined) params.set("name", query.name);
    return (await this.anonymous()).post(`${API}/projects/${slug}/runs?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}`, "content-type": "application/xml" },
      data: xml,
    });
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
