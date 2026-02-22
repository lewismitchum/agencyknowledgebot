// lib/authz.ts
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
  agencyEmail: string; // agency contact email
  userId: string;      // users.id
  userEmail: string;   // user email
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
  if (!session?.agencyId || !session?.agencyEmail) {
    throw new AuthzError("UNAUTHENTICATED");
  }

  const db: Db = await getDb();
  await ensureUserRoleColumns(db);

  const agency = (await db.get(
    `SELECT plan FROM agencies WHERE id = ? LIMIT 1`,
    session.agencyId
  )) as { plan: string | null } | undefined;

  const agencyId = String(session.agencyId);
  const agencyEmail = String(session.agencyEmail);

  // Prefer session.userId
  let user =
    session.userId ? await getUserById(agencyId, String(session.userId)) : null;

  // Fallback to session.userEmail (NOT agencyEmail)
  if (!user) {
    const ue = String(session.userEmail || "").trim().toLowerCase();
    if (ue) user = await getUserByEmail(agencyId, ue);
  }

  // Last resort: old cookies only had agencyEmail; try that (legacy), then create pending
  if (!user) {
    user = await getUserByEmail(agencyId, agencyEmail);
  }
  if (!user) {
    user = await getOrCreateUser(agencyId, agencyEmail);
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
    userEmail: String(user.email || "").trim().toLowerCase(),
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