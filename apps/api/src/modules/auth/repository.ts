import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sessions, users } from "../../db/schema.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

export interface SessionWithUser {
  sessionId: string;
  expiresAt: Date;
  user: { id: string; email: string; name: string };
}

/** Mengembalikan null jika email sudah dipakai (email harus sudah dinormalisasi). */
export async function createUser(
  db: Db,
  input: { email: string; name: string; passwordHash: string },
): Promise<{ id: string; email: string; name: string } | null> {
  const [row] = await db
    .insert(users)
    .values(input)
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, email: users.email, name: users.name });
  return row ?? null;
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}

export async function createSession(db: Db, input: { id: string; userId: string; expiresAt: Date }): Promise<void> {
  await db.insert(sessions).values(input);
}

export async function findSession(db: Db, sessionId: string): Promise<SessionWithUser | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
    user: { id: row.userId, email: row.email, name: row.name },
  };
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
