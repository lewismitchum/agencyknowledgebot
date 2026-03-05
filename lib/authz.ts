// lib/authz.ts
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getSessionFromRequest } from "@/lib/auth";
import { getDb, type Db } from "@/lib/db";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export type AuthedContext = {
  agencyId: string;
  agencyEmail: string;

  // membership row (users table)
  userId: string;
  userEmail: string;

  // global identity (optional; new)
  identityId?: string;
  identityEmail?: string;

  role: "owner" | "admin" | "member";
  status: "active" | "pending" | "blocked";
  plan: PlanKey;
};

export type AuthzErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN_NOT_ACTIVE"
  | "FORBIDDEN_NOT_OWNER"
  | "FORBIDDEN_NOT_ADMIN_OR_OWNER";

export class AuthzError extends Error {
  code: AuthzErrorCode;
  constructor(code: AuthzErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "AuthzError";
  }
}

type UserRow = {
  id: string;
  email: string;
  role: string | null;
  status: string | null;
};

function normalizeUserRole(raw: unknown): "owner" | "admin" | "member" {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function normalizeUserStatus(raw: unknown): "active" | "pending" | "blocked" {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "active") return "active";
  if (v === "blocked") return "blocked";
  return "pending";
}

async function ensureUserRoleColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN identity_id TEXT").catch(() => {});
}

async function ensureAgencyPlanColumn(db: Db) {
  await db.run("ALTER TABLE agencies ADD COLUMN plan TEXT").catch(() => {});
}

export function isOwnerOrAdmin(ctx: Pick<AuthedContext, "role">) {
  return ctx.role === "owner" || ctx.role === "admin";
}

export function isBillableMember(ctx: Pick<AuthedContext, "role">) {
  return ctx.role !== "owner" && ctx.role !== "admin";
}

async function getUserByIdLocal(db: Db, agencyId: string, userId: string): Promise<UserRow | null> {
  const row = (await db.get(
    `SELECT id, email, role, status
     FROM users
     WHERE agency_id = ? AND id = ?
     LIMIT 1`,
    agencyId,
    userId
  )) as UserRow | undefined;

  if (!row?.id) return null;
  return {
    id: String(row.id),
    email: String((row as any).email ?? ""),
    role: (row as any).role ?? null,
    status: (row as any).status ?? null,
  };
}

async function getUserByEmailLocal(db: Db, agencyId: string, email: string): Promise<UserRow | null> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return null;

  const row = (await db.get(
    `SELECT id, email, role, status
     FROM users
     WHERE agency_id = ? AND LOWER(email) = ?
     LIMIT 1`,
    agencyId,
    e
  )) as UserRow | undefined;

  if (!row?.id) return null;
  return {
    id: String(row.id),
    email: String((row as any).email ?? ""),
    role: (row as any).role ?? null,
    status: (row as any).status ?? null,
  };
}

async function createUserLocal(db: Db, agencyId: string, email: string): Promise<UserRow> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const e = String(email ?? "").trim().toLowerCase();

  // We keep defaults conservative:
  // - role: member
  // - status: pending (so owner/admin approval flow still works)
  // If your system expects active-by-default in some flows, you can change this to "active".
  const role = "member";
  const status = "pending";

  // Drift-safe insert: assumes these columns exist in your canonical schema:
  // users(id, agency_id, email, created_at, role, status)
  // If created_at doesn't exist, this will throw; so we attempt a smaller insert fallback.
  try {
    await db.run(
      `INSERT INTO users (id, agency_id, email, created_at, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      agencyId,
      e,
      now,
      role,
      status
    );
  } catch {
    // Fallback for older schemas
    await db.run(
      `INSERT INTO users (id, agency_id, email)
       VALUES (?, ?, ?)`,
      id,
      agencyId,
      e
    ).catch(() => {});
    // Best-effort set role/status if columns exist
    await db.run(`UPDATE users SET role = ? WHERE id = ? AND agency_id = ?`, role, id, agencyId).catch(() => {});
    await db.run(`UPDATE users SET status = ? WHERE id = ? AND agency_id = ?`, status, id, agencyId).catch(() => {});
  }

  return { id, email: e, role, status };
}

async function getOrCreateUserLocal(db: Db, agencyId: string, email: string): Promise<UserRow> {
  const existing = await getUserByEmailLocal(db, agencyId, email);
  if (existing) return existing;
  return await createUserLocal(db, agencyId, email);
}

export async function requireActiveMember(req: NextRequest): Promise<AuthedContext> {
  const session = getSessionFromRequest(req);
  if (!session?.agencyId || !session?.agencyEmail) throw new AuthzError("UNAUTHENTICATED");

  const db: Db = await getDb();
  await ensureUserRoleColumns(db);
  await ensureAgencyPlanColumn(db);

  const agencyId = String(session.agencyId);
  const agencyEmail = String(session.agencyEmail);

  const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan?: string | null }
    | undefined;

  const sessionUserId = (session as any).userId ? String((session as any).userId) : "";
  const sessionUserEmail = (session as any).userEmail
    ? String((session as any).userEmail).trim().toLowerCase()
    : "";

  const identityId = (session as any).identityId ? String((session as any).identityId) : undefined;
  const identityEmail = (session as any).identityEmail
    ? String((session as any).identityEmail).trim().toLowerCase()
    : undefined;

  let user: UserRow | null = null;

  if (sessionUserId) user = await getUserByIdLocal(db, agencyId, sessionUserId);
  if (!user && sessionUserEmail) user = await getUserByEmailLocal(db, agencyId, sessionUserEmail);

  // Back-compat: older cookies sometimes only had agencyEmail
  if (!user) user = await getUserByEmailLocal(db, agencyId, agencyEmail);

  // Final fallback: ensure membership row exists
  if (!user) {
    const seedEmail = sessionUserEmail || agencyEmail;
    user = await getOrCreateUserLocal(db, agencyId, seedEmail);
  }

  const role = normalizeUserRole(user.role);
  const status = normalizeUserStatus(user.status);

  if (status !== "active") {
    throw new AuthzError("FORBIDDEN_NOT_ACTIVE");
  }

  return {
    agencyId,
    agencyEmail,
    userId: user.id,
    userEmail: String(user.email || "").toLowerCase(),
    identityId,
    identityEmail,
    role,
    status,
    plan: normalizePlan(agency?.plan ?? null),
  };
}

export async function requireOwner(req: NextRequest): Promise<AuthedContext> {
  const ctx = await requireActiveMember(req);
  if (ctx.role !== "owner") throw new AuthzError("FORBIDDEN_NOT_OWNER");
  return ctx;
}

export async function requireOwnerOrAdmin(req: NextRequest): Promise<AuthedContext> {
  const ctx = await requireActiveMember(req);
  if (!isOwnerOrAdmin(ctx)) throw new AuthzError("FORBIDDEN_NOT_ADMIN_OR_OWNER");
  return ctx;
}