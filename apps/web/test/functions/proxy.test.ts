import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../../functions/api/[[path]].js";

const env = { API_ORIGIN: "https://api.example" };

type FetchStub = ReturnType<typeof vi.fn<(request: Request) => Promise<Response>>>;

function stubFetch(respond: (request: Request) => Response | Promise<Response> = () => new Response("ok")): FetchStub {
  const stub: FetchStub = vi.fn(async (request: Request) => respond(request));
  vi.stubGlobal("fetch", stub);
  return stub;
}

/** Request yang masuk ke Pages Function; `fetch` stub menerima Request ke API. */
async function proxy(request: Request, e: { API_ORIGIN: string; PROXY_SECRET?: string } = env): Promise<Response> {
  return onRequest({ request, env: e });
}

function upstreamRequest(stub: FetchStub): Request {
  expect(stub).toHaveBeenCalledTimes(1);
  return stub.mock.calls[0]![0];
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Pages Function proxy /api/*", () => {
  it("meneruskan method, path+query, body, dan cookie ke API_ORIGIN tanpa header host", async () => {
    const stub = stubFetch();
    const body = JSON.stringify({ email: "a@example.test", password: "rahasia-123" });

    await proxy(
      new Request("https://app.example/api/v1/auth/login?x=1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "tp_session=abc",
          origin: "https://app.example",
          host: "app.example",
        },
        body,
      }),
    );

    const upstream = upstreamRequest(stub);
    expect(upstream.url).toBe("https://api.example/api/v1/auth/login?x=1");
    expect(upstream.method).toBe("POST");
    expect(await upstream.text()).toBe(body);
    expect(upstream.headers.get("cookie")).toBe("tp_session=abc");
    expect(upstream.headers.get("content-type")).toBe("application/json");
    // Origin browser diteruskan apa adanya: API memeriksanya terhadap APP_ORIGIN.
    expect(upstream.headers.get("origin")).toBe("https://app.example");
    expect(upstream.headers.get("host")).toBeNull();
  });

  it("tidak me-rewrite path /api/health dan mengabaikan path pada API_ORIGIN", async () => {
    const stub = stubFetch();
    await proxy(new Request("https://app.example/api/health"), { API_ORIGIN: "https://api.example/" });
    expect(upstreamRequest(stub).url).toBe("https://api.example/api/health");
  });

  it("mengembalikan status, body, dan semua set-cookie dari API", async () => {
    stubFetch(() => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "tp_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax");
      headers.append("set-cookie", "other=1; Path=/");
      return new Response(JSON.stringify({ id: "u1" }), { status: 201, headers });
    });

    const res = await proxy(new Request("https://app.example/api/v1/auth/register", { method: "POST", body: "{}" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "u1" });
    expect(res.headers.getSetCookie()).toEqual([
      "tp_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
      "other=1; Path=/",
    ]);
  });

  it("POST tanpa body (logout) diteruskan dengan body null, bukan body kosong yang di-stream", async () => {
    const stub = stubFetch();

    await proxy(
      new Request("https://app.example/api/v1/auth/logout", { method: "POST", headers: { cookie: "tp_session=abc" } }),
    );

    const upstream = upstreamRequest(stub);
    expect(upstream.method).toBe("POST");
    expect(upstream.body).toBeNull();
    expect(upstream.headers.get("transfer-encoding")).toBeNull();
    expect([null, "0"]).toContain(upstream.headers.get("content-length"));
  });

  it("DELETE tanpa body juga diteruskan dengan body null", async () => {
    const stub = stubFetch();
    await proxy(new Request("https://app.example/api/v1/projects/x/members/y", { method: "DELETE" }));
    const upstream = upstreamRequest(stub);
    expect(upstream.method).toBe("DELETE");
    expect(upstream.body).toBeNull();
    expect(upstream.headers.get("transfer-encoding")).toBeNull();
  });

  it("body dibaca penuh (di-buffer), bukan di-stream, dan tidak memakai transfer-encoding chunked", async () => {
    const stub = stubFetch();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"name":'));
        controller.enqueue(new TextEncoder().encode('"Budi"}'));
        controller.close();
      },
    });
    await proxy(
      new Request("https://app.example/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    const upstream = upstreamRequest(stub);
    expect(upstream.headers.get("transfer-encoding")).toBeNull();
    expect(await upstream.text()).toBe('{"name":"Budi"}');
  });

  describe("IP klien (ruling R11)", () => {
    it("menimpa X-Forwarded-For dari klien dengan CF-Connecting-IP dan menambah X-Forwarded-Proto: https", async () => {
      const stub = stubFetch();
      await proxy(
        new Request("https://app.example/api/v1/auth/login", {
          method: "POST",
          headers: {
            "x-forwarded-for": "6.6.6.6, 7.7.7.7",
            "x-forwarded-proto": "http",
            "x-real-ip": "6.6.6.6",
            "true-client-ip": "6.6.6.6",
            forwarded: "for=6.6.6.6",
            "cf-connecting-ip": "203.0.113.9",
          },
          body: "{}",
        }),
      );
      const upstream = upstreamRequest(stub);
      expect(upstream.headers.get("x-forwarded-for")).toBe("203.0.113.9");
      expect(upstream.headers.get("x-forwarded-proto")).toBe("https");
      expect(upstream.headers.get("x-real-ip")).toBeNull();
      expect(upstream.headers.get("true-client-ip")).toBeNull();
      expect(upstream.headers.get("forwarded")).toBeNull();
    });

    it("x-tp-client-ip diisi dari CF-Connecting-IP; nilai kiriman klien selalu dibuang", async () => {
      const stub = stubFetch();
      await proxy(
        new Request("https://app.example/api/v1/auth/login", {
          method: "POST",
          headers: { "x-tp-client-ip": "6.6.6.6", "cf-connecting-ip": "203.0.113.9" },
          body: "{}",
        }),
      );
      expect(upstreamRequest(stub).headers.get("x-tp-client-ip")).toBe("203.0.113.9");
    });

    it("tanpa CF-Connecting-IP, x-tp-client-ip kiriman klien tidak diteruskan", async () => {
      const stub = stubFetch();
      await proxy(new Request("https://app.example/api/health", { headers: { "x-tp-client-ip": "6.6.6.6" } }));
      expect(upstreamRequest(stub).headers.get("x-tp-client-ip")).toBeNull();
    });

    it("PROXY_SECRET dikonfigurasi: x-proxy-secret ditambahkan, nilai kiriman klien diganti", async () => {
      const stub = stubFetch();
      await proxy(
        new Request("https://app.example/api/v1/auth/login", {
          method: "POST",
          headers: { "x-proxy-secret": "dipalsukan-klien", "cf-connecting-ip": "203.0.113.9" },
          body: "{}",
        }),
        { ...env, PROXY_SECRET: "rahasia-asli" },
      );
      const upstream = upstreamRequest(stub);
      expect(upstream.headers.get("x-proxy-secret")).toBe("rahasia-asli");
      expect(upstream.headers.get("x-tp-client-ip")).toBe("203.0.113.9");
      expect(upstream.headers.get("x-forwarded-for")).toBe("203.0.113.9");
    });

    it.each([undefined, ""])("PROXY_SECRET tidak dikonfigurasi (%j): x-proxy-secret kiriman klien dibuang", async (secret) => {
      const stub = stubFetch();
      await proxy(
        new Request("https://app.example/api/health", { headers: { "x-proxy-secret": "dipalsukan-klien" } }),
        { API_ORIGIN: env.API_ORIGIN, PROXY_SECRET: secret },
      );
      expect(upstreamRequest(stub).headers.get("x-proxy-secret")).toBeNull();
    });

    it("tanpa CF-Connecting-IP, X-Forwarded-For dari klien tetap tidak diteruskan", async () => {
      const stub = stubFetch();
      await proxy(new Request("https://app.example/api/health", { headers: { "x-forwarded-for": "6.6.6.6" } }));
      expect(upstreamRequest(stub).headers.get("x-forwarded-for")).toBeNull();
    });

    it("tidak meneruskan header cf-* ke API", async () => {
      const stub = stubFetch();
      await proxy(
        new Request("https://app.example/api/health", {
          headers: { "cf-connecting-ip": "203.0.113.9", "cf-ray": "abc", "cf-ipcountry": "ID", accept: "application/json" },
        }),
      );
      const upstream = upstreamRequest(stub);
      expect([...upstream.headers.keys()].filter((name) => name.startsWith("cf-"))).toEqual([]);
      expect(upstream.headers.get("accept")).toBe("application/json");
    });
  });

  describe("kegagalan upstream", () => {
    it("API tidak terjangkau → 502 dengan bentuk error standar (bukan halaman error Cloudflare)", async () => {
      stubFetch(() => {
        throw new TypeError("fetch failed");
      });
      const res = await proxy(new Request("https://app.example/api/health"));
      expect(res.status).toBe(502);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: expect.any(String) } });
    });

    it("API_ORIGIN kosong → 502 tanpa memanggil fetch", async () => {
      const stub = stubFetch();
      const res = await proxy(new Request("https://app.example/api/health"), { API_ORIGIN: "" });
      expect(res.status).toBe(502);
      expect(stub).not.toHaveBeenCalled();
    });

    it("redirect dari API tidak diikuti, diteruskan ke browser apa adanya", async () => {
      const stub = stubFetch(() => new Response(null, { status: 302, headers: { location: "/login" } }));
      const res = await proxy(new Request("https://app.example/api/v1/x"));
      expect(upstreamRequest(stub).redirect).toBe("manual");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });
  });
});
