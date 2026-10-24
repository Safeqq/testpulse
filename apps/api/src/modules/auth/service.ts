import { loginBody, registerBody, type LoginBody, type RegisterBody } from "@testpulse/shared";
import type { FastifyRequest } from "fastify";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { parseOrThrow } from "../../http/validate.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./domain/passwords.js";
import { generateToken, hashToken, SESSION_TTL_DAYS } from "./domain/tokens.js";
import {
  createSession,
  createUser,
  deleteSession,
  findSession,
  findUserByEmail,
} from "./repository.js";

export const SESSION_COOKIE = "tp_session";
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Diisi oleh preHandler `loadUser`; null jika tidak ada sesi yang berlaku. */
    user: AuthUser | null;
  }
}

export interface IssuedSession {
  user: AuthUser;
  /** Token mentah untuk cookie; hanya hash-nya yang disimpan di DB. */
  token: string;
}

async function issueSession(db: Db, user: AuthUser): Promise<IssuedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await createSession(db, { id: hashToken(token), userId: user.id, expiresAt });
  return { user, token };
}

export async function register(db: Db, input: unknown): Promise<IssuedSession> {
  const body: RegisterBody = parseOrThrow(registerBody, input);
  const passwordHash = await hashPassword(body.password);
  const user = await createUser(db, { email: body.email, name: body.name, passwordHash });
  if (!user) {
    throw new AppError(409, "EMAIL_TAKEN", "Email sudah terdaftar");
  }
  return issueSession(db, user);
}

const INVALID_CREDENTIALS = "Email atau password salah";

export async function login(db: Db, input: unknown): Promise<IssuedSession> {
  const body: LoginBody = parseOrThrow(loginBody, input);
  const found = await findUserByEmail(db, body.email);
  const valid = found ? await verifyPassword(body.password, found.passwordHash) : await burnPasswordCheck(body.password);
  if (!found || !valid) {
    throw new AppError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
  }
  return issueSession(db, { id: found.id, email: found.email, name: found.name });
}

export async function logout(db: Db, token: string): Promise<void> {
  await deleteSession(db, hashToken(token));
}

/** Mencari user dari token sesi; sesi kedaluwarsa dihapus dan dianggap tidak ada. */
export async function authenticate(db: Db, token: string): Promise<AuthUser | null> {
  const session = await findSession(db, hashToken(token));
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await deleteSession(db, session.sessionId);
    return null;
  }
  return session.user;
}

/** preHandler: mengisi `req.user` dari cookie sesi (null jika tidak ada/tidak berlaku). */
export async function loadUser(req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  req.user = token ? await authenticate(req.server.db, token) : null;
}

/** preHandler (dipasang setelah `loadUser`): 401 UNAUTHENTICATED jika belum login. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  if (!req.user) {
    throw new AppError(401, "UNAUTHENTICATED", "Anda harus masuk terlebih dahulu");
  }
}
