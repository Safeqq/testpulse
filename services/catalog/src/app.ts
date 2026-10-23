import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import type { ProductRepository, StockChangeResult } from "./repository.js";

export interface AppDeps {
  products: ProductRepository;
  logger?: boolean;
}

const idParams = z.object({ id: z.coerce.number().int().positive() });
const quantityBody = z.object({ quantity: z.number().int().positive().max(100) });

// Semua error memakai bentuk { error, message } supaya mudah di-assert di API & contract test.
const errorBody = (error: string, message: string) => ({ error, message });

export function buildApp({ products, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send(errorBody("VALIDATION_ERROR", err.issues.map((i) => i.message).join("; ")));
    }
    app.log.error(err);
    return reply.code(500).send(errorBody("INTERNAL_ERROR", "Terjadi kesalahan pada server"));
  });

  app.get("/health", async () => ({ status: "ok", service: "catalog" }));

  app.get("/products", async () => products.list());

  app.get("/products/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const product = await products.findById(id);
    if (!product) return reply.code(404).send(errorBody("PRODUCT_NOT_FOUND", `Produk ${id} tidak ditemukan`));
    return product;
  });

  const sendStockResult = (id: number, result: StockChangeResult, reply: FastifyReply) => {
    switch (result.status) {
      case "ok":
        return reply.send({ productId: id, remainingStock: result.remainingStock });
      case "not_found":
        return reply.code(404).send(errorBody("PRODUCT_NOT_FOUND", `Produk ${id} tidak ditemukan`));
      case "insufficient_stock":
        return reply
          .code(409)
          .send({ ...errorBody("INSUFFICIENT_STOCK", `Stok produk ${id} tidak cukup`), availableStock: result.availableStock });
    }
  };

  app.post("/products/:id/reserve", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { quantity } = quantityBody.parse(req.body);
    return sendStockResult(id, await products.reserve(id, quantity), reply);
  });

  app.post("/products/:id/release", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { quantity } = quantityBody.parse(req.body);
    return sendStockResult(id, await products.release(id, quantity), reply);
  });

  return app;
}
