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
