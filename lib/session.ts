// lib/session.ts
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const SESSION_COOKIE = "louis_session";

/**
 * Session should include:
 * - agencyId (workspace selection)
 * - userId/userEmail (membership row in users table)
 * - identityId/identityEmail (global account identity)
 *
 * Backward compatible: identity fields are optional for older callers.
 */
export function setSessionCookie(
  res: NextResponse,
  opts: {
    agencyId: string;
    agencyEmail: string;

    // membership (users row)
    userId: string;
    userEmail: string;

    // global identity (new)
    identityId?: string;
    identityEmail?: string;
  }
) {
  const userEmail = String(opts.userEmail || "").trim().toLowerCase();
  const identityEmail = String(opts.identityEmail || userEmail).trim().toLowerCase();

  const token = signSession({
    agencyId: opts.agencyId,
    agencyEmail: opts.agencyEmail,

    userId: opts.userId,
    userEmail,

    // new fields (only include when present)
    ...(opts.identityId ? { identityId: opts.identityId } : {}),
    ...(identityEmail ? { identityEmail } : {}),
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