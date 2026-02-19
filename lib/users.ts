// lib/users.ts
import { getDb, type Db } from "@/lib/db";
import { randomUUID } from "crypto";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export type UserRow = {
  id: string;
  agency_id: string;
  email: string;
  email_verified: number;
  created_at: string | null;
  updated_at: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "pending" | "blocked";
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return (email || "").trim().toLowerCase();
}

function normalizeRole(raw: any): "owner" | "admin" | "member" {
  const v = String(raw ?? "").toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function normalizeStatus(raw: any): "active" | "pending" | "blocked" {
  const v = String(raw ?? "").toLowerCase();
  if (v === "active") return "active";
  if (v === "blocked") return "blocked";
  return "pending";
}

async function countBillableMembers(db: Db, agencyId: string): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) as c
     FROM users
     WHERE agency_id = ?
       AND role = 'member'
       AND status = 'active'`,
    agencyId
  )) as { c: number } | undefined;

  return Number(row?.c ?? 0);
}

async function enforceSeatLimit(db: Db, agencyId: string) {
  const planRow = (await db.get(
    `SELECT plan FROM agencies WHERE id = ? LIMIT 1`,
    agencyId
  )) as { plan: string | null } | undefined;

  const plan = normalizePlan(planRow?.plan ?? null);
  const limits = getPlanLimits(plan);

  if (limits.max_users == null) return;

  const used = await countBillableMembers(db, agencyId);
  if (used >= limits.max_users) {
    throw Object.assign(new Error("SEAT_LIMIT_EXCEEDED"), {
      code: "SEAT_LIMIT_EXCEEDED",
      plan,
      used,
      limit: limits.max_users,
    });
  }
}

export async function getUserById(
  agencyId: string,
  userId: string
): Promise<UserRow | null> {
  const db: Db = await getDb();
  await ensureSchema(db);

  const row = (await db.get(
    `SELECT id, agency_id, email, email_verified, created_at, updated_at, role, status
     FROM users
     WHERE agency_id = ? AND id = ?
     LIMIT 1`,
    agencyId,
    userId
  )) as UserRow | undefined;

  if (!row?.id) return null;

  return {
    ...row,
    role: normalizeRole(row.role),
    status: normalizeStatus(row.status),
  };
}

export async function getUserByEmail(
  agencyId: string,
  email: string
): Promise<UserRow | null> {
  const db: Db = await getDb();
  await ensureSchema(db);

  const normalizedEmail = normalizeEmail(email);

  const row = (await db.get(
    `SELECT id, agency_id, email, email_verified, created_at, updated_at, role, status
     FROM users
     WHERE agency_id = ? AND lower(email) = ?
     LIMIT 1`,
    agencyId,
    normalizedEmail
  )) as UserRow | undefined;

  if (!row?.id) return null;

  return {
    ...row,
    role: normalizeRole(row.role),
    status: normalizeStatus(row.status),
  };
}

/**
 * Canonical rule:
 * - If user exists → return it
 * - If new user → enforce seat limits, then create as MEMBER + PENDING
 */
export async function getOrCreateUser(
  agencyId: string,
  email: string
): Promise<UserRow> {
  const db: Db = await getDb();
  await ensureSchema(db);

  const normalizedEmail = normalizeEmail(email);

  const existing = (await db.get(
    `SELECT id, agency_id, email, email_verified, created_at, updated_at, role, status
     FROM users
     WHERE agency_id = ? AND lower(email) = ?
     LIMIT 1`,
    agencyId,
    normalizedEmail
  )) as UserRow | undefined;

  if (existing?.id) {
    return {
      ...existing,
      role: normalizeRole(existing.role),
      status: normalizeStatus(existing.status),
    };
  }

  // 🔒 Enforce seat limits BEFORE creating a new member
  await enforceSeatLimit(db, agencyId);

  const id = randomUUID();
  const t = nowIso();

  await db.run(
    `INSERT INTO users
     (id, agency_id, email, email_verified, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'member', 'pending', ?, ?)`,
    id,
    agencyId,
    normalizedEmail,
    t,
    t
  );

  const created = await getUserById(agencyId, id);
  if (!created) throw new Error("USER_CREATE_FAILED");
  return created;
}

// Convenience helpers
export function normalizeUserRole(raw: any) {
  return normalizeRole(raw);
}
export function normalizeUserStatus(raw: any) {
  return normalizeStatus(raw);
}
