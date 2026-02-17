// lib/auth/requireAuth.ts
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { getDb } from "@/lib/db";

export type AuthedUser = {
  id: string;
  agencyId: string;
  agencyEmail: string;
  role: "owner" | "admin" | "member";
  status: "active" | "pending" | "blocked";
};

type SessionPayload = {
  agencyId: string;
  agencyEmail: string;
  userId: string;
  role?: string;
  status?: string;
};

function normRole(v: any): "owner" | "admin" | "member" {
  const s = String(v ?? "").toLowerCase();
  if (s === "owner") return "owner";
  if (s === "admin") return "admin";
  return "member";
}

function normStatus(v: any): "active" | "pending" | "blocked" {
  const s = String(v ?? "").toLowerCase();
  if (s === "active") return "active";
  if (s === "blocked") return "blocked";
  return "pending";
}

function readSessionFromCookies(): SessionPayload | null {
  const raw = cookies().get("louis_session")?.value || null;
  if (!raw) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  try {
    const decoded = jwt.verify(raw, secret) as any;
    if (!decoded?.agencyId || !decoded?.agencyEmail || !decoded?.userId) return null;
    return {
      agencyId: String(decoded.agencyId),
      agencyEmail: String(decoded.agencyEmail),
      userId: String(decoded.userId),
      role: decoded.role,
      status: decoded.status,
    };
  } catch {
    return null;
  }
}

/**
 * Server-component auth helper.
 * Throws on unauthenticated (so callers can redirect).
 */
export async function requireAuth(): Promise<AuthedUser> {
  const session = readSessionFromCookies();
  if (!session) throw new Error("UNAUTHENTICATED");

  const db: any = await getDb();

  // Confirm the user exists + belongs to the agency (avoid trusting cookie blindly)
  const row = await db.get(
    `SELECT id, agency_id, email, role, status
     FROM users
     WHERE id = ? AND agency_id = ?
     LIMIT 1`,
    session.userId,
    session.agencyId
  );

  if (!row?.id) throw new Error("UNAUTHENTICATED");

  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    agencyEmail: String(row.email ?? session.agencyEmail),
    role: normRole(row.role ?? session.role),
    status: normStatus(row.status ?? session.status),
  };
}
