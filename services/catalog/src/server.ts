import { buildApp } from "./app.js";
import { createPool, migrate } from "./db.js";
import { createProductRepository } from "./repository.js";

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.CATALOG_DATABASE_URL ?? "postgres://shopqa:shopqa@localhost:5432/catalog";

const pool = createPool(databaseUrl);
await migrate(pool);

const app = buildApp({ products: createProductRepository(pool), logger: true });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host: "0.0.0.0" });
