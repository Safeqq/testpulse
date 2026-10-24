import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  COOKIE_HEADERS,
  JSON_COOKIE_HEADERS,
  PROJECT_SLUG,
  PUBLIC_SLUG,
  STATE,
  clientFor,
  createPact,
  dateTime,
  errorBody,
  slugLike,
  text,
  uuidLike,
} from "./pact.js";

const pact = createPact();
const { regex } = MatchersV3;

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

/** Bentuk ProjectDto; `visibility` dan `myRole` memakai nilai pasti karena ditentukan provider state. */
function projectBody(fields: { name: string; slug: string; visibility: "private" | "public"; myRole: string | null }) {
  return {
    id: uuidLike(PROJECT_ID),
    name: text(fields.name),
    slug: slugLike(fields.slug),
    visibility: regex(/^(private|public)$/, fields.visibility),
    createdAt: dateTime(),
    myRole: fields.myRole,
  };
}

describe("kontrak projects", () => {
  it("GET /projects mengembalikan daftar project milik user (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("daftar project user")
      .withRequest("GET", "/api/v1/projects", (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody(
          MatchersV3.eachLike(
            projectBody({ name: "Pact Project", slug: PROJECT_SLUG, visibility: "private", myRole: "admin" }),
          ),
        ),
      )
      .executeTest(async (server) => {
        const list = await clientFor(server, true).projects.list();
        expect(list.length).toBeGreaterThan(0);
        expect(list[0]?.slug).toBe(PROJECT_SLUG);
      });
  });

  it("POST /projects membuat project (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiLoggedIn)
      .uponReceiving("membuat project baru")
      .withRequest("POST", "/api/v1/projects", (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "Pact Baru", slug: "pact-baru" }),
      )
      .willRespondWith(201, (b) =>
        b.jsonBody(projectBody({ name: "Pact Baru", slug: "pact-baru", visibility: "private", myRole: "admin" })),
      )
      .executeTest(async (server) => {
        const project = await clientFor(server, true).projects.create({ name: "Pact Baru", slug: "pact-baru" });
        expect(project.slug).toBe("pact-baru");
        expect(project.myRole).toBe("admin");
      });
  });

  it("POST /projects dengan slug terpakai -> 409 SLUG_TAKEN", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("membuat project dengan slug yang sudah dipakai")
      .withRequest("POST", "/api/v1/projects", (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "Pact Lain", slug: PROJECT_SLUG }),
      )
      .willRespondWith(409, (b) => b.jsonBody(errorBody("SLUG_TAKEN", "Slug sudah dipakai")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).projects.create({ name: "Pact Lain", slug: PROJECT_SLUG }),
        ).rejects.toMatchObject({ status: 409, code: "SLUG_TAKEN" });
      });
  });

  it("GET /projects/:slug mengembalikan detail project (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("detail project sebagai admin")
      .withRequest("GET", `/api/v1/projects/${PROJECT_SLUG}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody(projectBody({ name: "Pact Project", slug: PROJECT_SLUG, visibility: "private", myRole: "admin" })),
      )
      .executeTest(async (server) => {
        const project = await clientFor(server, true).projects.get(PROJECT_SLUG);
        expect(project.myRole).toBe("admin");
      });
  });

  it("GET /projects/:slug project publik dapat dibaca anonim (200, myRole null)", async () => {
    await pact
      .addInteraction()
      .given(STATE.publicProject)
      .uponReceiving("detail project publik tanpa login")
      .withRequest("GET", `/api/v1/projects/${PUBLIC_SLUG}`)
      .willRespondWith(200, (b) =>
        b.jsonBody(projectBody({ name: "Pact Public", slug: PUBLIC_SLUG, visibility: "public", myRole: null })),
      )
      .executeTest(async (server) => {
        const project = await clientFor(server).projects.get(PUBLIC_SLUG);
        expect(project.visibility).toBe("public");
        expect(project.myRole).toBeNull();
      });
  });

  it("GET /projects/:slug yang tidak ada -> 404 PROJECT_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiLoggedIn)
      .uponReceiving("detail project yang tidak ada")
      .withRequest("GET", "/api/v1/projects/tidak-ada", (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("PROJECT_NOT_FOUND", "Project tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).projects.get("tidak-ada")).rejects.toMatchObject({
          status: 404,
          code: "PROJECT_NOT_FOUND",
        });
      });
  });

  it("PATCH /projects/:slug mengubah visibilitas (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("mengubah visibilitas project menjadi publik")
      .withRequest("PATCH", `/api/v1/projects/${PROJECT_SLUG}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ visibility: "public" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody(projectBody({ name: "Pact Project", slug: PROJECT_SLUG, visibility: "public", myRole: "admin" })),
      )
      .executeTest(async (server) => {
        const project = await clientFor(server, true).projects.update(PROJECT_SLUG, { visibility: "public" });
        expect(project.visibility).toBe("public");
      });
  });

  it("DELETE /projects/:slug menghapus project (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("menghapus project dengan konfirmasi slug")
      .withRequest("DELETE", `/api/v1/projects/${PROJECT_SLUG}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ confirmSlug: PROJECT_SLUG }),
      )
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).projects.remove(PROJECT_SLUG, { confirmSlug: PROJECT_SLUG }),
        ).resolves.toBeUndefined();
      });
  });
});
