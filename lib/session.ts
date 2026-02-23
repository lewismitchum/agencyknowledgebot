// lib/session.ts
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const SESSION_COOKIE = "louis_session";

/**
 * Session MUST include per-user identity (userId + userEmail) to prevent
 * everyone resolving to the agency email (which causes cross-user bot visibility).
 */
export function setSessionCookie(
  res: NextResponse,
  opts: {
    agencyId: string;
    agencyEmail: string;

    // ✅ per-user identity
    userId: string;
    userEmail: string;
  }
) {
  const token = signSession({
    agencyId: opts.agencyId,
    agencyEmail: opts.agencyEmail,
    userId: opts.userId,
    userEmail: String(opts.userEmail || "").trim().toLowerCase(),
  });

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