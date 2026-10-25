import { createdInvitationDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject, createTestApp, registerUser } from "./helpers.js";

const APP_ORIGIN = "http://localhost:5173";

describe("log request", () => {
  const lines: string[] = [];
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(
      { appOrigin: APP_ORIGIN },
      {
        logLevel: "info",
        logStream: {
          write(msg: string) {
            lines.push(msg);
          },
        },
      },
    );
  });

  it("token undangan pada URL pratinjau dan accept tidak pernah masuk log", async () => {
    const admin = await registerUser(app);
    const taker = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    const created = createdInvitationDto.parse(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/projects/${project.slug}/invitations`,
          headers: { cookie: admin.cookie },
          payload: { role: "tester" },
        })
      ).json(),
    );
    const token = created.url.slice(`${APP_ORIGIN}/invite/`.length);
    expect(token.length).toBeGreaterThan(20);

    const preview = await app.inject({ method: "GET", url: `/api/v1/invitations/${token}` });
    expect(preview.statusCode).toBe(200);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      headers: { cookie: taker.cookie },
    });
    expect(accepted.statusCode).toBe(200);
    // Token yang sudah dipakai: jalur error juga mencatat request.
    const again = await app.inject({ method: "GET", url: `/api/v1/invitations/${token}` });
    expect(again.statusCode).toBe(410);

    const joined = lines.join("");
    // Bukti request memang tercatat (dengan segmen tersensor), bukan log kosong.
    expect(joined).toContain('"url":"/api/v1/invitations/[REDACTED]"');
    expect(joined).toContain('"url":"/api/v1/invitations/[REDACTED]/accept"');
    expect(joined).toContain('"method":"POST"');
    expect(joined).not.toContain(token);
    // Id undangan di path project bukan rahasia dan tetap tercatat apa adanya.
    await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.slug}/invitations/${created.id}`,
      headers: { cookie: admin.cookie },
    });
    expect(lines.join("")).toContain(`/invitations/${created.id}`);
  });
});

describe("log rahasia proxy", () => {
  it("nilai x-proxy-secret tidak pernah masuk log, termasuk pada respons 401 dan 429", async () => {
    const secret = "rahasia-proxy-yang-tidak-boleh-bocor-9f8e7d";
    const lines: string[] = [];
    const app = await createTestApp(
      { proxySecret: secret, rateLimitMax: 1 },
      {
        logLevel: "info",
        logStream: {
          write(msg: string) {
            lines.push(msg);
          },
        },
      },
    );
    const login = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "x-proxy-secret": secret, "x-forwarded-for": "203.0.113.9" },
        payload: { email: "tidak-ada@example.test", password: "salah-salah" },
      });
    expect((await login()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(429);

    const joined = lines.join("");
    // Bukti request tercatat (bukan log kosong) dan kunci tetap bisa dilihat dari remoteAddress peer.
    expect(joined).toContain('"url":"/api/v1/auth/login"');
    expect(joined).not.toContain(secret);
  });
});
