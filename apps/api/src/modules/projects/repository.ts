import type { Role, Visibility } from "@testpulse/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { memberships, projects } from "../../db/schema.js";

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  visibility: Visibility;
  createdAt: Date;
}

export interface ProjectWithRole {
  project: ProjectRecord;
  role: Role | null;
}

// UUID nol tidak pernah cocok dengan user mana pun; menjaga satu query untuk anonim maupun login.
const NO_USER = "00000000-0000-0000-0000-000000000000";

const projectColumns = {
  id: projects.id,
  name: projects.name,
  slug: projects.slug,
  visibility: projects.visibility,
  createdAt: projects.createdAt,
};

type ProjectRow = Omit<ProjectRecord, "visibility"> & { visibility: string };

// Kolom visibility dibatasi CHECK constraint ke 'private' | 'public'.
function toRecord(row: ProjectRow): ProjectRecord {
  return { ...row, visibility: row.visibility as Visibility };
}

/**
 * Membuat project dan membership admin pembuatnya dalam satu transaksi.
 * Mengembalikan null jika slug sudah dipakai (aman terhadap pembuatan serentak).
 */
export async function insertProjectWithAdmin(
  db: Db,
  input: { name: string; slug: string; createdBy: string },
): Promise<ProjectRecord | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values(input)
      .onConflictDoNothing({ target: projects.slug })
      .returning(projectColumns);
    if (!row) return null;
    await tx.insert(memberships).values({ projectId: row.id, userId: input.createdBy, role: "admin" });
    return toRecord(row);
  });
}

/** Project berdasarkan slug beserta role `userId` di dalamnya (null jika bukan anggota / tanpa user). */
export async function findBySlug(db: Db, slug: string, userId: string | null): Promise<ProjectWithRole | null> {
  const [row] = await db
    .select({ ...projectColumns, role: memberships.role })
    .from(projects)
    .leftJoin(memberships, and(eq(memberships.projectId, projects.id), eq(memberships.userId, userId ?? NO_USER)))
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!row) return null;
  const { role, ...project } = row;
  return { project: toRecord(project), role: role as Role | null };
}

/** Project tempat user menjadi anggota, urut nama. */
export async function listForUser(db: Db, userId: string): Promise<ProjectWithRole[]> {
  const rows = await db
    .select({ ...projectColumns, role: memberships.role })
    .from(memberships)
    .innerJoin(projects, eq(projects.id, memberships.projectId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(projects.name), asc(projects.createdAt));
  return rows.map(({ role, ...project }) => ({ project: toRecord(project), role: role as Role }));
}

/** Mengubah nama / visibilitas; null jika project sudah tidak ada. */
export async function update(
  db: Db,
  id: string,
  changes: { name?: string; visibility?: Visibility },
): Promise<ProjectRecord | null> {
  const [row] = await db.update(projects).set(changes).where(eq(projects.id, id)).returning(projectColumns);
  return row ? toRecord(row) : null;
}

/** Menghapus project; membership dan undangan ikut terhapus (ON DELETE CASCADE). */
export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, id));
}
