import type { InvitableRole } from "@testpulse/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { invitations, memberships, projects, users } from "../../db/schema.js";
import { invitationStatus } from "./domain/invitations.js";

export interface InvitationRecord {
  id: string;
  projectId: string;
  role: InvitableRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface ActiveInvitationRecord {
  id: string;
  role: InvitableRole;
  expiresAt: Date;
  createdAt: Date;
  createdBy: { id: string; name: string };
}

export interface InvitationWithProject extends InvitationRecord {
  projectName: string;
  projectSlug: string;
}

const invitationColumns = {
  id: invitations.id,
  projectId: invitations.projectId,
  role: invitations.role,
  expiresAt: invitations.expiresAt,
  acceptedAt: invitations.acceptedAt,
  revokedAt: invitations.revokedAt,
};

type InvitationRow = Omit<InvitationRecord, "role"> & { role: string };

// Kolom role dibatasi CHECK constraint ke 'tester' | 'viewer'.
function toRecord(row: InvitationRow): InvitationRecord {
  return { ...row, role: row.role as InvitableRole };
}

export async function insertInvitation(
  db: Db,
  input: { projectId: string; tokenHash: string; role: InvitableRole; createdBy: string; expiresAt: Date },
): Promise<{ id: string; role: InvitableRole; expiresAt: Date }> {
  const [row] = await db
    .insert(invitations)
    .values(input)
    .returning({ id: invitations.id, role: invitations.role, expiresAt: invitations.expiresAt });
  if (!row) throw new Error("insert undangan tidak mengembalikan baris");
  return { ...row, role: row.role as InvitableRole };
}

/** Undangan yang masih aktif (belum dicabut, dipakai, atau kedaluwarsa), terbaru lebih dulu. */
export async function listActiveInvitations(db: Db, projectId: string, now: Date): Promise<ActiveInvitationRecord[]> {
  const rows = await db
    .select({
      ...invitationColumns,
      createdAt: invitations.createdAt,
      creatorId: users.id,
      creatorName: users.name,
    })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.createdBy))
    .where(and(eq(invitations.projectId, projectId), isNull(invitations.revokedAt), isNull(invitations.acceptedAt)))
    .orderBy(desc(invitations.createdAt), desc(invitations.id));

  return rows
    .filter((row) => invitationStatus(row, now) === "active")
    .map((row) => ({
      id: row.id,
      role: row.role as InvitableRole,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      createdBy: { id: row.creatorId, name: row.creatorName },
    }));
}

/**
 * Mencabut undangan yang masih aktif milik project ini.
 * Mengembalikan false jika id tidak dikenal, milik project lain, atau sudah tidak aktif
 * (dicabut / terpakai / kedaluwarsa). Bersifat atomik terhadap accept yang berjalan serentak.
 */
export async function revokeActiveInvitation(db: Db, projectId: string, id: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(invitationColumns)
      .from(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.projectId, projectId)))
      .limit(1)
      .for("update");
    if (!row || invitationStatus(row, now) !== "active") return false;
    await tx.update(invitations).set({ revokedAt: now }).where(eq(invitations.id, id));
    return true;
  });
}

/** Undangan berdasarkan hash token beserta project-nya; null jika tidak dikenal. */
export async function findByTokenHash(db: Db, tokenHash: string): Promise<InvitationWithProject | null> {
  const [row] = await db
    .select({ ...invitationColumns, projectName: projects.name, projectSlug: projects.slug })
    .from(invitations)
    .innerJoin(projects, eq(projects.id, invitations.projectId))
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  return row ? { ...toRecord(row), projectName: row.projectName, projectSlug: row.projectSlug } : null;
}

export type AcceptResult =
  | { kind: "accepted"; projectSlug: string; role: InvitableRole }
  | { kind: "not_found" }
  | { kind: "rejected"; status: "used" | "expired" }
  | { kind: "already_member" };

/**
 * Menerima undangan secara atomik. Baris undangan dikunci (`FOR UPDATE`) lebih dulu dan statusnya
 * dibaca ulang setelah kunci diperoleh, sehingga dua penerima serentak tidak bisa sama-sama berhasil:
 * yang kedua melihat undangan sudah terpakai. Jika user sudah anggota, undangan tetap tidak terpakai.
 */
export async function acceptInvitation(db: Db, tokenHash: string, userId: string, now: Date): Promise<AcceptResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(invitationColumns)
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash))
      .limit(1)
      .for("update");
    if (!row) return { kind: "not_found" };

    const status = invitationStatus(row, now);
    if (status === "revoked") return { kind: "not_found" };
    if (status !== "active") return { kind: "rejected", status };

    const [project] = await tx
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    if (!project) return { kind: "not_found" };

    const [existing] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.projectId, row.projectId), eq(memberships.userId, userId)))
      .limit(1);
    if (existing) return { kind: "already_member" };

    await tx.insert(memberships).values({ projectId: row.projectId, userId, role: row.role });
    await tx.update(invitations).set({ acceptedAt: now, acceptedBy: userId }).where(eq(invitations.id, row.id));
    return { kind: "accepted", projectSlug: project.slug, role: row.role as InvitableRole };
  });
}
