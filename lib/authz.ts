import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getDb, type Db } from "@/lib/db";
import { getOrCreateUser, getUserByEmail, getUserById, normalizeUserRole, normalizeUserStatus } from "@/lib/users";
import { normalizePlan } from "@/lib/plans";

export type AuthedContext = {
  agencyId: string;
  agencyEmail: string;
  userId: string;
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
  // Best-effort: ignore if already exists
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
}

export async function requireActiveMember(req: NextRequest): Promise<AuthedContext> {
  const session = getSessionFromRequest(req);
  if (!session?.agencyId || !session?.agencyEmail) {
    throw new AuthzError("UNAUTHENTICATED");
  }

  const db: Db = await getDb();
  await ensureUserRoleColumns(db);

  // Agency plan (used by feature gates elsewhere)
  const agency = (await db.get(
    `SELECT plan FROM agencies WHERE id = ? LIMIT 1`,
    session.agencyId
  )) as { plan: string | null } | undefined;

  // ✅ Identify the correct user (session.userId first)
  const agencyId = String(session.agencyId);
  const agencyEmail = String(session.agencyEmail);

  let user =
    (session as any).userId ? await getUserById(agencyId, String((session as any).userId)) : null;

  if (!user) {
    // Back-compat for old cookies
    user = await getUserByEmail(agencyId, agencyEmail);
  }

  if (!user) {
    // Last resort: create as PENDING (safe)
    user = await getOrCreateUser(agencyId, agencyEmail);
  }

  // Normalize role/status (do not invent meanings)
  const role = normalizeUserRole(user.role);
  const status = normalizeUserStatus(user.status);

  // ✅ No auto-promotion. Pending users are denied (owner must approve).
  if (status !== "active") {
    throw new AuthzError("FORBIDDEN_NOT_ACTIVE");
  }

  return {
    agencyId,
    agencyEmail,
    userId: user.id,
    role,
    status,
    plan: normalizePlan(agency?.plan ?? null),
  };
}

export async function requireOwner(req: NextRequest): Promise<AuthedContext> {
  const ctx = await requireActiveMember(req);
  if (ctx.role !== "owner") {
    throw new AuthzError("FORBIDDEN_NOT_OWNER");
  }
  return ctx;
}
