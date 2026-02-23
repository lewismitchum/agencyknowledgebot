// lib/session.ts
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const SESSION_COOKIE = "louis_session";

/**
 * Session should carry BOTH:
 * - agency identity (agencyId/agencyEmail)
 * - per-user identity (userId/userEmail)
 *
 * Role/status are always loaded from DB in requireActiveMember/requireOwner.
 */
export function setSessionCookie(
  res: NextResponse,
  opts: {
    agencyId: string;
    agencyEmail: string;
    userId?: string;
    userEmail?: string;
  }
) {
  const token = signSession({
    agencyId: opts.agencyId,
    agencyEmail: opts.agencyEmail,
    userId: opts.userId,
    userEmail: opts.userEmail,
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