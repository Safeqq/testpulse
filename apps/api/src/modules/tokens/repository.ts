import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { projects, projectTokens, users } from "../../db/schema.js";

/** Batas token aktif per project (spec Tahap 2 §3). */
export const MAX_ACTIVE_TOKENS = 10;

export interface ActiveTokenRecord {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  createdBy: { id: string; name: string };
}

export type InsertTokenResult =
  | { kind: "created"; id: string; name: string; createdAt: Date }
  | { kind: "limit_reached" };

/**
 * Menyimpan token baru jika project masih punya kurang dari MAX_ACTIVE_TOKENS token aktif.
 * Baris project dikunci (`FOR UPDATE`) selama hitung + insert, sehingga pembuatan serentak
 * untuk project yang sama berjalan berurutan dan tidak pernah menghasilkan token aktif ke-11.
 */
export async function insertTokenWithinLimit(
  db: Db,
  input: { projectId: string; name: string; tokenHash: string; createdBy: string },
): Promise<InsertTokenResult> {
  return db.transaction(async (tx) => {
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).for("update");

    const [active] = await tx
      .select({ n: count() })
      .from(projectTokens)
      .where(and(eq(projectTokens.projectId, input.projectId), isNull(projectTokens.revokedAt)));
    if ((active?.n ?? 0) >= MAX_ACTIVE_TOKENS) return { kind: "limit_reached" };

    const [row] = await tx
      .insert(projectTokens)
      .values(input)
      .returning({ id: projectTokens.id, name: projectTokens.name, createdAt: projectTokens.createdAt });
    if (!row) throw new Error("insert token tidak mengembalikan baris");
    return { kind: "created", ...row };
  });
}

/** Token yang belum dicabut, terbaru lebih dulu. Hash token tidak pernah dikembalikan. */
export async function listActiveTokens(db: Db, projectId: string): Promise<ActiveTokenRecord[]> {
  const rows = await db
    .select({
      id: projectTokens.id,
      name: projectTokens.name,
      createdAt: projectTokens.createdAt,
      lastUsedAt: projectTokens.lastUsedAt,
      creatorId: users.id,
      creatorName: users.name,
    })
    .from(projectTokens)
    .innerJoin(users, eq(users.id, projectTokens.createdBy))
    .where(and(eq(projectTokens.projectId, projectId), isNull(projectTokens.revokedAt)))
    .orderBy(desc(projectTokens.createdAt), desc(projectTokens.id));

  return rows.map(({ creatorId, creatorName, ...token }) => ({
    ...token,
    createdBy: { id: creatorId, name: creatorName },
  }));
}

/**
 * Mencabut token aktif milik project ini (mengisi `revoked_at`; baris tetap ada agar run lama tetap
 * terhubung). Mengembalikan false jika id tidak dikenal, milik project lain, atau sudah dicabut.
 * Satu UPDATE bersyarat, jadi atomik terhadap pencabutan serentak.
 */
export async function revokeActiveToken(db: Db, projectId: string, id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(projectTokens)
    .set({ revokedAt: now })
    .where(and(eq(projectTokens.id, id), eq(projectTokens.projectId, projectId), isNull(projectTokens.revokedAt)))
    .returning({ id: projectTokens.id });
  return rows.length > 0;
}

/** Token aktif berdasarkan hash (lewat unique index `token_hash`); null jika tidak dikenal atau dicabut. */
export async function findActiveTokenByHash(
  db: Db,
  tokenHash: string,
): Promise<{ tokenId: string; projectId: string } | null> {
  const [row] = await db
    .select({ tokenId: projectTokens.id, projectId: projectTokens.projectId })
    .from(projectTokens)
    .where(and(eq(projectTokens.tokenHash, tokenHash), isNull(projectTokens.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function markTokenUsed(db: Db, tokenId: string, now: Date): Promise<void> {
  await db.update(projectTokens).set({ lastUsedAt: now }).where(eq(projectTokens.id, tokenId));
}
