// lib/session.ts
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const SESSION_COOKIE = "louis_session";

/**
 * Session token stored in cookie.
 * We include userId/userEmail when available to prevent identity ambiguity
 * (critical for private bots, ownership checks, etc).
 *
 * Back-compat: older cookies may only have agencyId/agencyEmail.
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
  const payload: any = {
    agencyId: opts.agencyId,
    agencyEmail: opts.agencyEmail,
  };

  if (opts.userId) payload.userId = opts.userId;
  if (opts.userEmail) payload.userEmail = opts.userEmail;

  const token = signSession(payload);

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