import { faker } from "@faker-js/faker";
import { projectDto, userDto, type ProjectDto, type Role, type UserDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, inject } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import { memberships } from "../../src/db/schema.js";

const createdApps: FastifyInstance[] = [];

afterAll(async () => {
  await Promise.all(createdApps.splice(0).map((app) => app.close()));
});

/**
 * Membangun app untuk test integrasi terhadap database Testcontainers.
 * App milik helper ini ditutup otomatis pada akhir file test.
 */
export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config: AppConfig = {
    databaseUrl: inject("databaseUrl"),
    appOrigin: "http://localhost:5173",
    cookieSecure: false,
    port: 0,
    rateLimitMax: 1000,
    ...overrides,
  };
  const app = await buildApp(config, { logLevel: "silent" });
  createdApps.push(app);
  return app;
}

export interface RegisteredUser {
  user: UserDto;
  /** Nilai siap pakai untuk header `cookie`, mis. `tp_session=abc`. */
  cookie: string;
  password: string;
}

/** Mendaftarkan user dengan data unik (faker) lewat API dan mengembalikan cookie sesinya. */
export async function registerUser(
  app: FastifyInstance,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<RegisteredUser> {
  const payload = {
    name: faker.person.fullName().slice(0, 80),
    email: `${faker.string.uuid()}@example.test`,
    password: faker.internet.password({ length: 16 }),
    ...overrides,
  };
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload });
  if (res.statusCode !== 201) {
    throw new Error(`registerUser gagal: ${res.statusCode} ${res.body}`);
  }
  const session = res.cookies.find((c) => c.name === "tp_session");
  if (!session) throw new Error("registerUser: cookie tp_session tidak ada");
  return { user: userDto.parse(res.json()), cookie: `tp_session=${session.value}`, password: payload.password };
}

/** Membuat project lewat API sebagai pemilik cookie; nama unik (faker) kecuali di-override. */
export async function createProject(
  app: FastifyInstance,
  cookie: string,
  overrides: Partial<{ name: string; slug: string }> = {},
): Promise<ProjectDto> {
  const payload = { name: `Proyek ${faker.string.alphanumeric(10)}`, ...overrides };
  const res = await app.inject({ method: "POST", url: "/api/v1/projects", headers: { cookie }, payload });
  if (res.statusCode !== 201) {
    throw new Error(`createProject gagal: ${res.statusCode} ${res.body}`);
  }
  return projectDto.parse(res.json());
}

/** Menyisipkan membership langsung ke DB (menyiapkan data tanpa melewati API). */
export async function addMember(
  app: FastifyInstance,
  projectId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await app.db.insert(memberships).values({ projectId, userId, role });
}
