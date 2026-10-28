import type { IncomingHttpHeaders } from "node:http";
import type { VerifierOptions } from "@pact-foundation/pact";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../../src/db/client.js";
import { invitations, memberships, projectTokens, projects, sessions, users } from "../../src/db/schema.js";
import { hashPassword } from "../../src/modules/auth/domain/passwords.js";
import { generateToken, hashToken, SESSION_TTL_DAYS } from "../../src/modules/auth/domain/tokens.js";

type StateHandlers = NonNullable<VerifierOptions["stateHandlers"]>;
// Tipe express tidak tersedia di workspace ini; cukup bentuk minimal yang dipakai filter.
type RequestFilter = (req: { headers: IncomingHttpHeaders }, res: unknown, next: () => void) => void;

const DAY_MS = 24 * 60 * 60 * 1000;

// Data tetap; harus sama dengan nilai yang dipakai consumer (apps/web/test/contract/pact.ts).
const PASSWORD = "rahasia123";
const BUDI = { id: "11111111-1111-4111-8111-111111111111", email: "budi@pact.dev", name: "Budi" };
const SARI = { id: "22222222-2222-4222-8222-222222222222", email: "sari@pact.dev", name: "Sari" };
const OWNER = { id: "55555555-5555-4555-8555-555555555555", email: "owner@pact.dev", name: "Pemilik" };
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_SLUG = "pact-project";
const PUBLIC_SLUG = "pact-public";
const INGEST_PROJECT_SLUG = "testpulse";

/** Token mentah yang dikirim consumer (hanya SHA-256-nya yang disimpan, seperti pada API). */
const FAKE_SESSION_TOKEN = "pact-token";
const INVITE_TOKEN = "pact-invite-token";
const EXPIRED_INVITE_TOKEN = "pact-expired-token";
/**
 * Token CI mentah yang dikirim reporter (packages/reporter/test/contract/pact.ts). Bentuknya `tp_` + 43 karakter
 * base64url, seperti token asli; hanya SHA-256-nya yang disimpan.
 */
const INGEST_TOKEN = "tp_pact-ingest-token-for-contract-tests-A1B2C3";

interface Person {
  id: string;
  email: string;
  name: string;
}

export interface ContractStates {
  stateHandlers: StateHandlers;
  /** Dipanggil sebelum tiap interaksi: mengosongkan DB agar tiap interaksi terisolasi. */
  beforeEach: () => Promise<void>;
  /** Mengganti cookie sesi palsu `pact-token` dengan token sesi asli milik user pada state. */
  requestFilter: RequestFilter;
}

export function createContractStates(db: Db): ContractStates {
  /** Token sesi asli untuk interaksi yang sedang diverifikasi; null jika state tidak membuat sesi. */
  let sessionToken: string | null = null;
  let passwordHash: string | undefined;

  async function ensureUser(person: Person): Promise<void> {
    passwordHash ??= await hashPassword(PASSWORD);
    await db.insert(users).values({ ...person, passwordHash }).onConflictDoNothing();
  }

  async function ensureSession(userId: string): Promise<void> {
    const token = generateToken();
    await db.insert(sessions).values({
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS),
    });
    sessionToken = token;
  }

  async function findProject(slug: string) {
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
    return project;
  }

  /** Membuat project (beserta admin pembuatnya) bila belum ada; kembali memakai yang sudah ada. */
  async function ensureProject(slug: string, name: string, visibility: "private" | "public", owner: Person) {
    const existing = await findProject(slug);
    if (existing) return existing;
    await ensureUser(owner);
    const [created] = await db
      .insert(projects)
      .values({ name, slug, visibility, createdBy: owner.id })
      .returning();
    if (!created) throw new Error(`gagal membuat project ${slug}`);
    await db.insert(memberships).values({ projectId: created.id, userId: owner.id, role: "admin" });
    return created;
  }

  async function ensureMembership(projectId: string, userId: string, role: "admin" | "tester" | "viewer") {
    await db
      .insert(memberships)
      .values({ projectId, userId, role })
      .onConflictDoUpdate({ target: [memberships.projectId, memberships.userId], set: { role } });
  }

  async function ensureInvitation(token: string, expiresAt: Date, id?: string) {
    const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
    const tokenHash = hashToken(token);
    const [existing] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash));
    if (existing) return;
    await db.insert(invitations).values({
      ...(id ? { id } : {}),
      projectId: project.id,
      tokenHash,
      role: "tester",
      createdBy: project.createdBy,
      expiresAt,
    });
  }

  const stateHandlers: StateHandlers = {
    "tidak ada user": async () => {},

    "user budi@pact.dev terdaftar": async () => {
      await ensureUser(BUDI);
    },

    "budi login": async () => {
      await ensureUser(BUDI);
      await ensureSession(BUDI.id);
    },

    "budi admin project pact-project": async () => {
      await ensureUser(BUDI);
      await ensureSession(BUDI.id);
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", BUDI);
      await ensureMembership(project.id, BUDI.id, "admin");
    },

    "project publik pact-public ada": async () => {
      await ensureProject(PUBLIC_SLUG, "Pact Public", "public", OWNER);
    },

    "undangan pact-invite-token aktif untuk pact-project": async () => {
      await ensureInvitation(INVITE_TOKEN, new Date(Date.now() + 7 * DAY_MS), INVITATION_ID);
    },

    "undangan pact-expired-token kedaluwarsa untuk pact-project": async () => {
      await ensureInvitation(EXPIRED_INVITE_TOKEN, new Date(Date.now() - DAY_MS));
    },

    "project testpulse punya token aktif pact-ingest-token": async () => {
      const project = await ensureProject(INGEST_PROJECT_SLUG, "TestPulse", "public", OWNER);
      await db
        .insert(projectTokens)
        .values({ projectId: project.id, name: "Pact ingest", tokenHash: hashToken(INGEST_TOKEN), createdBy: OWNER.id })
        .onConflictDoNothing();
    },

    "sari anggota tester di pact-project": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await ensureUser(SARI);
      await ensureMembership(project.id, SARI.id, "tester");
    },
  };

  const beforeEach = async () => {
    sessionToken = null;
    await db.execute(sql`truncate table ${invitations}, ${memberships}, ${sessions}, ${projects}, ${users} cascade`);
  };

  const requestFilter: RequestFilter = (req, _res, next) => {
    const cookie = req.headers.cookie;
    if (cookie && sessionToken) {
      req.headers.cookie = cookie.replace(`tp_session=${FAKE_SESSION_TOKEN}`, `tp_session=${sessionToken}`);
    }
    // Request tanpa body (mis. logout) dikirim verifier tanpa content-length; proxy-nya lalu meneruskan
    // dengan `transfer-encoding: chunked` sehingga dianggap membawa body. Klien asli (fetch) mengirim
    // `content-length: 0`, jadi samakan di sini.
    if (req.headers["content-length"] === undefined && req.headers["content-type"] === undefined) {
      req.headers["content-length"] = "0";
    }
    next();
  };

  return { stateHandlers, beforeEach, requestFilter };
}
