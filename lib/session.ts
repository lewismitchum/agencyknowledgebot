// lib/session.ts
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const SESSION_COOKIE = "louis_session";

/**
 * Session should include per-user identity.
 * Authz + role/status still come from DB in `lib/authz.ts`,
 * but we MUST persist userId so invited members don't "become" the agency email user.
 */
export function setSessionCookie(
  res: NextResponse,
  opts: {
    agencyId: string;
    agencyEmail: string;

    // ✅ per-user identity (required for correct isolation)
    userId?: string;
    userEmail?: string;
    role?: "owner" | "admin" | "member";
    status?: "active" | "pending" | "blocked";
  }
) {
  const token = signSession({
    agencyId: opts.agencyId,
    agencyEmail: opts.agencyEmail,
    userId: opts.userId,
    userEmail: opts.userEmail,
    role: opts.role,
    status: opts.status,
  } as any);

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}