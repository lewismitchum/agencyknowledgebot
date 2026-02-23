// lib/authz.ts
import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getDb, type Db } from "@/lib/db";
import { getOrCreateUser, getUserByEmail, getUserById, normalizeUserRole, normalizeUserStatus } from "@/lib/users";
import { normalizePlan } from "@/lib/plans";

export type AuthedContext = {
  agencyId: string;
  agencyEmail: string;
  userId: string;
  userEmail: string;
  role: "owner" | "admin" | "member";
  status: "active" | "pending" | "blocked";
  plan: string | null;
};

export type AuthzErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN_NOT_ACTIVE"
  | "FORBIDDEN_NOT_OWNER";

export class AuthzError extends Error {
  code: AuthzErrorCode;
  constructor(code: AuthzErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "AuthzError";
  }
}

async function ensureUserRoleColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
}

export async function requireActiveMember(req: NextRequest): Promise<AuthedContext> {
  const session = getSessionFromRequest(req);
  if (!session?.agencyId || !session?.agencyEmail) throw new AuthzError("UNAUTHENTICATED");

  const db: Db = await getDb();
  await ensureUserRoleColumns(db);

  const agency = (await db.get(
    `SELECT plan FROM agencies WHERE id = ? LIMIT 1`,
    String(session.agencyId)
  )) as { plan: string | null } | undefined;

  const agencyId = String(session.agencyId);
  const agencyEmail = String(session.agencyEmail);

  // ✅ prefer per-user identity
  const sessionUserId = (session as any).userId ? String((session as any).userId) : "";
  const sessionUserEmail = (session as any).userEmail ? String((session as any).userEmail).trim().toLowerCase() : "";

  let user =
    sessionUserId ? await getUserById(agencyId, sessionUserId) : null;

  if (!user && sessionUserEmail) {
    user = await getUserByEmail(agencyId, sessionUserEmail);
  }

  // Back-compat fallback (older cookies) — but this is NOT ideal for members
  if (!user) {
    user = await getUserByEmail(agencyId, agencyEmail);
  }

  if (!user) {
    // last resort: create as PENDING (safe)
    const seedEmail = sessionUserEmail || agencyEmail;
    user = await getOrCreateUser(agencyId, seedEmail);
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