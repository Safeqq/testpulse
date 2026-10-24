import type { Role, Visibility } from "@testpulse/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { memberships, projects, users } from "../../db/schema.js";
import { wouldLeaveNoAdmin } from "./domain/admins.js";

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

export interface MemberRecord {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
}

const memberColumns = {
  userId: users.id,
  name: users.name,
  email: users.email,
  role: memberships.role,
  joinedAt: memberships.createdAt,
};

function toMemberRecord(row: Omit<MemberRecord, "role"> & { role: string }): MemberRecord {
  return { ...row, role: row.role as Role };
}

/** Anggota project, urut waktu bergabung lalu nama. */
export async function listMembers(db: Db, projectId: string): Promise<MemberRecord[]> {
  const rows = await db
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.projectId, projectId))
    .orderBy(asc(memberships.createdAt), asc(users.name), asc(users.id));
  return rows.map(toMemberRecord);
}

/** Satu anggota project; null jika bukan anggota. */
export async function findMember(db: Db, projectId: string, userId: string): Promise<MemberRecord | null> {
  const [row] = await db
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)))
    .limit(1);
  return row ? toMemberRecord(row) : null;
}

/**
 * Mengubah role anggota (`newRole`) atau mengeluarkannya (`null`) sambil menjaga minimal satu admin.
 *
 * Seluruh baris admin project dikunci (`FOR UPDATE`) lebih dulu, baru dihitung. Transaksi paralel
 * yang menyentuh admin project yang sama menunggu di kunci ini, lalu menghitung ulang dari data
 * yang sudah di-commit, sehingga dua request tidak bisa sama-sama lolos dan menyisakan nol admin.
 */
export async function changeMemberRole(
  db: Db,
  projectId: string,
  userId: string,
  newRole: Role | null,
): Promise<"ok" | "not_member" | "last_admin"> {
  return db.transaction(async (tx) => {
    // ORDER BY menjaga urutan pengambilan kunci tetap sama antar transaksi (menghindari deadlock).
    const admins = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.role, "admin")))
      .orderBy(asc(memberships.userId))
      .for("update");

    // Dibaca setelah kunci diperoleh agar role target mencerminkan data yang sudah di-commit.
    const [target] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)))
      .limit(1);
    if (!target) return "not_member";

    const targetCurrentRole = target.role as Role;
    if (wouldLeaveNoAdmin({ adminCount: admins.length, targetCurrentRole, targetNewRole: newRole })) {
      return "last_admin";
    }

    const where = and(eq(memberships.projectId, projectId), eq(memberships.userId, userId));
    if (newRole === null) {
      await tx.delete(memberships).where(where);
    } else {
      await tx.update(memberships).set({ role: newRole }).where(where);
    }
    return "ok";
  });
}
