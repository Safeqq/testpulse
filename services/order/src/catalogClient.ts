// Order service hanya bergantung pada interface ini, sehingga nanti bisa diuji dengan
// contract test (Pact) di satu sisi dan fake/stub di unit test di sisi lain.

export interface CatalogProduct {
  id: number;
  name: string;
  price: number;
  stock: number;
}

export type ReserveResult = "ok" | "not_found" | "insufficient_stock";

export interface CatalogClient {
  getProduct(id: number): Promise<CatalogProduct | null>;
  reserve(id: number, quantity: number): Promise<ReserveResult>;
  release(id: number, quantity: number): Promise<void>;
}

export class CatalogUnavailableError extends Error {}

const TIMEOUT_MS = 3_000;

export function createCatalogClient(baseUrl: string, fetchFn: typeof fetch = fetch): CatalogClient {
  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    try {
      return await fetchFn(new URL(path, baseUrl), {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new CatalogUnavailableError(`Catalog service tidak dapat dihubungi: ${(err as Error).message}`);
    }
  };

  const unexpected = (res: Response) =>
    new CatalogUnavailableError(`Respons tidak terduga dari catalog service: HTTP ${res.status}`);

  return {
    async getProduct(id) {
      const res = await call(`/products/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) throw unexpected(res);
      const body = (await res.json()) as CatalogProduct;
      return { id: body.id, name: body.name, price: body.price, stock: body.stock };
    },

    async reserve(id, quantity) {
      const res = await call(`/products/${id}/reserve`, { method: "POST", body: JSON.stringify({ quantity }) });
      if (res.ok) return "ok";
      if (res.status === 404) return "not_found";
      if (res.status === 409) return "insufficient_stock";
      throw unexpected(res);
    },

    async release(id, quantity) {
      const res = await call(`/products/${id}/release`, { method: "POST", body: JSON.stringify({ quantity }) });
      if (!res.ok) throw unexpected(res);
    },
  };
}
