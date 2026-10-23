import { buildApp } from "./app.js";
import { createCatalogClient } from "./catalogClient.js";
import { createPool, migrate } from "./db.js";
import { createOrderRepository, createUserRepository } from "./repository.js";

const port = Number(process.env.PORT ?? 3002);
const databaseUrl = process.env.ORDER_DATABASE_URL ?? "postgres://shopqa:shopqa@localhost:5432/orders";
const catalogUrl = process.env.CATALOG_URL ?? "http://localhost:3001";
const jwtSecret = process.env.JWT_SECRET ?? "dev-secret-ganti-di-production";

const pool = createPool(databaseUrl);
await migrate(pool);

const app = buildApp({
  users: createUserRepository(pool),
  orders: createOrderRepository(pool),
  catalog: createCatalogClient(catalogUrl),
  jwtSecret,
  logger: true,
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host: "0.0.0.0" });
