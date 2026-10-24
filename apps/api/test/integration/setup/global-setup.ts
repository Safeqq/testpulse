import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { createDb } from "../../../src/db/client.js";
import { runMigrations } from "../../../src/db/migrate.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const url = container.getConnectionUri();

  const { db, pool } = createDb(url);
  try {
    await runMigrations(db);
  } finally {
    await pool.end();
  }

  project.provide("databaseUrl", url);

  return async () => {
    await container.stop();
  };
}
