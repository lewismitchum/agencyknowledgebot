import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getDb, type Db } from "@/lib/db";
import {
  getOrCreateUser,
  getUserByEmail,
  getUserById,
  normalizeUserRole,
  normalizeUserStatus,
} from "@/lib/users";
import { normalizePlan } from "@/lib/plans";

export type AuthedContext = {
  agencyId: string;
  agencyEmail: string; // agency contact email (NOT user identity)
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
  const session: any = getSessionFromRequest(req);

  const agencyId = String(session?.agencyId ?? "");
  const agencyEmail = String(session?.agencyEmail ?? "");
  const sessionUserId = session?.userId ? String(session.userId) : "";
  const sessionUserEmail = session?.userEmail ? String(session.userEmail) : "";

  if (!agencyId) throw new AuthzError("UNAUTHENTICATED");

  // IMPORTANT:
  // agencyEmail is shared contact email (bad identity).
  // userEmail must be per-user for correct isolation.
  const userEmail = (sessionUserEmail || "").trim().toLowerCase();

  const db: Db = await getDb();
  await ensureUserRoleColumns(db);

  const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan: string | null }
    | undefined;

  // ✅ Resolve user strictly from session.userId first
  let user = sessionUserId ? await getUserById(agencyId, sessionUserId) : null;

  // ✅ Fallback: session.userEmail (per-user)
  if (!user && userEmail) {
    user = await getUserByEmail(agencyId, userEmail);
  }

  // ⚠️ Legacy fallback (last resort only): agencyEmail
  // This is ONLY to avoid breaking old owner sessions. It is NOT a valid member identity.
  if (!user && agencyEmail) {
    user = await getUserByEmail(agencyId, String(agencyEmail).trim().toLowerCase());
  }

  // If still missing, create a pending user ONLY if we have a per-user email.
  if (!user) {
    if (!userEmail) throw new AuthzError("UNAUTHENTICATED");
    user = await getOrCreateUser(agencyId, userEmail);
  }

  const role = normalizeUserRole(user.role);
  const status = normalizeUserStatus(user.status);

  // No auto-promotion. Pending/blocked are denied.
  if (status !== "active") {
    throw new AuthzError("FORBIDDEN_NOT_ACTIVE");
  }

  return {
    agencyId,
    agencyEmail,
    userId: user.id,
    userEmail: String(user.email || "").trim().toLowerCase(),
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