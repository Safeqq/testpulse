import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { CatalogUnavailableError, type CatalogClient } from "./catalogClient.js";
import { verifyPassword } from "./passwords.js";
import { calculateTotals, normalizePromoCode, PricingError } from "./pricing.js";
import type { NewOrder, OrderRepository, UserRepository } from "./repository.js";

export interface AppDeps {
  users: UserRepository;
  orders: OrderRepository;
  catalog: CatalogClient;
  jwtSecret: string;
  logger?: boolean;
}

interface TokenUser {
  sub: string;
  email: string;
  name: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenUser;
    user: TokenUser;
  }
}

/** Error domain yang langsung dipetakan ke HTTP response. */
class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const orderBody = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(10),
      }),
    )
    .min(1)
    .max(20),
  promoCode: z.string().trim().min(1).max(32).optional(),
});

const idParams = z.object({ id: z.coerce.number().int().positive() });

const errorBody = (error: string, message: string, extra: Record<string, unknown> = {}) => ({ error, message, ...extra });

export function buildApp({ users, orders, catalog, jwtSecret, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  app.register(fastifyJwt, { secret: jwtSecret, sign: { expiresIn: "2h" } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send(errorBody("VALIDATION_ERROR", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send(errorBody(err.code, err.message, err.extra));
    if (err instanceof PricingError) return reply.code(400).send(errorBody(err.code, err.message));
    if (err instanceof CatalogUnavailableError) {
      app.log.error(err);
      return reply.code(503).send(errorBody("CATALOG_UNAVAILABLE", "Layanan katalog sedang tidak tersedia"));
    }
    app.log.error(err);
    return reply.code(500).send(errorBody("INTERNAL_ERROR", "Terjadi kesalahan pada server"));
  });

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send(errorBody("UNAUTHORIZED", "Silakan login terlebih dahulu"));
    }
  };

  /** Ambil harga & nama terbaru dari catalog — harga dari client tidak pernah dipercaya. */
  const resolveLines = async (items: z.infer<typeof orderBody>["items"]) => {
    const merged = new Map<number, number>();
    for (const { productId, quantity } of items) merged.set(productId, (merged.get(productId) ?? 0) + quantity);

    return Promise.all(
      [...merged].map(async ([productId, quantity]) => {
        const product = await catalog.getProduct(productId);
        if (!product) throw new HttpError(422, "PRODUCT_NOT_FOUND", `Produk ${productId} tidak ditemukan`, { productId });
        if (product.stock < quantity) {
          throw new HttpError(409, "INSUFFICIENT_STOCK", `Stok ${product.name} tidak cukup`, {
            productId,
            availableStock: product.stock,
          });
        }
        return { productId, productName: product.name, unitPrice: product.price, quantity };
      }),
    );
  };

  app.get("/health", async () => ({ status: "ok", service: "order" }));

  app.post("/auth/login", async (req, reply) => {
    const { email, password } = loginBody.parse(req.body);
    const user = await users.findByEmail(email);
    // Pesan error sama untuk email tidak terdaftar & password salah (mencegah user enumeration).
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send(errorBody("INVALID_CREDENTIALS", "Email atau password salah"));
    }
    const token = app.jwt.sign({ sub: String(user.id), email: user.email, name: user.name });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  });

  // Pratinjau total belanja (dipakai halaman checkout) tanpa mengurangi stok.
  app.post("/orders/quote", async (req) => {
    const { items, promoCode } = orderBody.parse(req.body);
    const lines = await resolveLines(items);
    const totals = calculateTotals(lines, promoCode);
    return {
      items: lines.map((l) => ({ ...l, lineTotal: l.unitPrice * l.quantity })),
      promoCode: promoCode ? normalizePromoCode(promoCode) : null,
      ...totals,
    };
  });

  app.post("/orders", { preHandler: authenticate }, async (req, reply) => {
    const { items, promoCode } = orderBody.parse(req.body);
    const lines = await resolveLines(items);
    const totals = calculateTotals(lines, promoCode);

    // Reservasi stok satu per satu; jika satu gagal, kembalikan stok yang sudah direservasi (kompensasi).
    const reserved: { productId: number; quantity: number }[] = [];
    const rollback = () => Promise.allSettled(reserved.map((r) => catalog.release(r.productId, r.quantity)));
    try {
      for (const line of lines) {
        const result = await catalog.reserve(line.productId, line.quantity);
        if (result !== "ok") {
          throw new HttpError(409, "INSUFFICIENT_STOCK", `Stok ${line.productName} tidak cukup`, { productId: line.productId });
        }
        reserved.push(line);
      }

      const newOrder: NewOrder = {
        userId: Number(req.user.sub),
        promoCode: promoCode ? normalizePromoCode(promoCode) : null,
        items: lines,
        ...totals,
      };
      return reply.code(201).send(await orders.create(newOrder));
    } catch (err) {
      await rollback();
      throw err;
    }
  });

  app.get("/orders", { preHandler: authenticate }, async (req) => orders.listByUser(Number(req.user.sub)));

  app.get("/orders/:id", { preHandler: authenticate }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const order = await orders.findById(id);
    // 404 (bukan 403) untuk pesanan milik user lain, agar keberadaan order lain tidak bocor.
    if (!order || order.userId !== Number(req.user.sub)) {
      return reply.code(404).send(errorBody("ORDER_NOT_FOUND", `Pesanan ${id} tidak ditemukan`));
    }
    return order;
  });

  return app;
}
