import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../../config.js";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  loadUser,
  login,
  logout,
  register,
  requireUser,
  type IssuedSession,
} from "./service.js";

export async function authRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
  } as const;
  const rateLimit = { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } };

  function setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_MAX_AGE_SECONDS });
  }

  app.post("/auth/register", { config: rateLimit }, async (req, reply) => {
    const session: IssuedSession = await register(app.db, req.body);
    setSessionCookie(reply, session.token);
    return reply.status(201).send(session.user);
  });

  app.post("/auth/login", { config: rateLimit }, async (req, reply) => {
    const session: IssuedSession = await login(app.db, req.body);
    setSessionCookie(reply, session.token);
    return reply.status(200).send(session.user);
  });

  app.post("/auth/logout", { preHandler: [loadUser, requireUser] }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await logout(app.db, token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.status(204).send();
  });

  app.get("/auth/me", { preHandler: [loadUser, requireUser] }, async (req) => req.user);
}
