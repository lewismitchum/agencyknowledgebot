import { getDb, type Db } from "@/lib/db";
import { randomUUID } from "crypto";

export type UserRow = {
  id: string;
  agency_id: string;
  email: string;
  email_verified: number;
  created_at: string | null;
  updated_at: string | null;
  role?: string | null;
  status?: string | null;
};

async function ensureUserColumns(db: Db) {
  // Best-effort schema patching (no migrations required)
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
}

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

async function backfillRoleStatus(db: Db, userId: string) {
  // Only fill blanks; do not change meaning of existing values
  await db.run(
    `UPDATE users
     SET role = COALESCE(NULLIF(role, ''), 'member'),
         status = COALESCE(NULLIF(status, ''), 'pending'),
         updated_at = COALESCE(updated_at, ?)
     WHERE id = ?`,
    nowIso(),
    userId
  );
}

export async function getUserById(agencyId: string, userId: string): Promise<UserRow | null> {
  const db: Db = await getDb();
  await ensureUserColumns(db);

  const row = (await db.get(
    `SELECT id, agency_id, email, email_verified, created_at, updated_at, role, status
     FROM users
     WHERE agency_id = ? AND id = ?
     LIMIT 1`,
    agencyId,
    userId
  )) as UserRow | undefined;

  if (!row?.id) return null;

  const needsRole = row.role == null || String(row.role).trim() === "";
  const needsStatus = row.status == null || String(row.status).trim() === "";
  if (needsRole || needsStatus) {
    await backfillRoleStatus(db, row.id);
    const patched = (await db.get(
      `SELECT id, agency_id, email, email_verified, created_at, updated_at, role, status
       FROM users
       WHERE agency_id = ? AND id = ?
       LIMIT 1`,
      agencyId,
      userId
    )) as UserRow | undefined;
    return patched ?? row;
  }

  return row;
}

export async function getUserByEmail(agencyId: string, email: string): Promise<UserRow | null> {
  const db: Db = await getDb();
  await ensureUserColumns(db);

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

  const needsRole = row.role == null || String(row.role).trim() === "";
  const needsStatus = row.status == null || String(row.status).trim() === "";
  if (needsRole || needsStatus) {
    await backfillRoleStatus(db, row.id);
    const patched = (await db.get(
      `SELECT id, agency_id, email, email_verified, created_at, updated_at, role, status
       FROM users
       WHERE agency_id = ? AND lower(email) = ?
       LIMIT 1`,
      agencyId,
      normalizedEmail
    )) as UserRow | undefined;
    return patched ?? row;
  }

  return row;
}

/**
 * Canonical v1 rule (post-approvals):
 * - New users are created as MEMBER + PENDING by default.
 * - Only owners/admins (or accept-invite) should set ACTIVE.
 * - BLOCKED is a real deny state.
 */
export async function getOrCreateUser(agencyId: string, email: string): Promise<UserRow> {
  const db: Db = await getDb();
  await ensureUserColumns(db);

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
    // Backfill blanks only (do NOT auto-promote pending -> active)
    const needsRole = existing.role == null || String(existing.role).trim() === "";
    const needsStatus = existing.status == null || String(existing.status).trim() === "";
    if (needsRole || needsStatus) {
      await backfillRoleStatus(db, existing.id);
      const patched = await getUserById(agencyId, existing.id);
      if (patched) return patched;
    }
    return existing;
  }

  const id = randomUUID();
  const t = nowIso();

  // ✅ New users are PENDING by default (safe)
  await db.run(
    `INSERT INTO users (id, agency_id, email, email_verified, role, status, created_at, updated_at)
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

// Convenience helpers (optional to use elsewhere)
export function normalizeUserRole(raw: any) {
  return normalizeRole(raw);
}
export function normalizeUserStatus(raw: any) {
  return normalizeStatus(raw);
}
