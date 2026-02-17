// lib/session.ts
import { NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

export const SESSION_COOKIE = "louis_session";

/**
 * Identity-only session.
 * Role/status/userId come from DB via `getOrCreateUser` + `requireActiveMember/requireOwner` in `lib/authz.ts`.
 */
export function setSessionCookie(
  res: NextResponse,
  opts: {
    agencyId: string;
    agencyEmail: string;
  }
) {
  const token = signSession({
    agencyId: opts.agencyId,
    agencyEmail: opts.agencyEmail,
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
