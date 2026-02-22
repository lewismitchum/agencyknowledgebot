// lib/session.ts
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const SESSION_COOKIE = "louis_session";

/**
 * Session cookie.
 * Must include per-user identity (userId/userEmail) so private bots/docs are isolated.
 */
export function setSessionCookie(
  res: NextResponse,
  opts: {
    agencyId: string;
    agencyEmail: string; // agency contact email
    userId?: string;     // per-user id (users.id)
    userEmail?: string;  // per-user email
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