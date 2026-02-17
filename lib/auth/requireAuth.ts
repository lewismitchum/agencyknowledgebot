import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { verifySession, type Session } from "@/lib/authz";

export type AuthedUser = {
  id: string;
  agency_id: string;
  email: string;
  email_verified: number | boolean;
};

/**
 * IMPORTANT:
 * - Real auth = JWT cookie "louis_session" (see /lib/auth.ts)
 * - This function exists mainly as a compatibility shim for any code importing requireAuth().
 *
 * Behavior:
 * 1) Prefer louis_session JWT (new system).
 * 2) Fallback to legacy "session" token + sessions table (old system), if still present.
 *
 * This avoids breaking older imports while we fully migrate.
 */

// Supports BOTH Next.js variants:
// - cookies() returns cookies object (sync)
// - cookies() returns Promise<ReadonlyRequestCookies> (async)
async function getCookie(name: string): Promise<string | null> {
  try {
    const cAny: any = cookies();
    if (cAny && typeof cAny.then === "function") {
      const resolved = await cAny;
      return resolved?.get?.(name)?.value ?? null;
    }
    return cAny?.get?.(name)?.value ?? null;
  } catch {
    return null;
  }
}

function unauthorized() {
  const err: any = new Error("Unauthorized");
  err.status = 401;
  throw err;
}

export async function requireAuth(): Promise<{ user: AuthedUser; session?: Session }> {
  const db: any = await getDb();

  // ----------------------------
  // 1) NEW SYSTEM: louis_session JWT
  // ----------------------------
  const jwtToken = await getCookie("louis_session");
  if (jwtToken) {
    const sess = verifySession(jwtToken);
    if (!sess?.userId || !sess?.agencyId || !sess?.agencyEmail) unauthorized();

    // Prefer DB truth for user fields (email_verified etc),
    // but we can always fall back to the session email.
    const user = (await db.get(
      "SELECT id, agency_id, email, email_verified FROM users WHERE id = ? LIMIT 1",
      sess.userId
    )) as AuthedUser | undefined;

    if (user?.id && user?.agency_id) {
      return { user, session: sess };
    }

    // If DB row missing for some reason, we still fail hard (safer)
    unauthorized();
  }

  // -----------------------------------
  // 2) LEGACY SYSTEM: cookie "session" + sessions table
  // -----------------------------------
  const legacyToken = await getCookie("session");
  if (!legacyToken) unauthorized();

  const legacySess = (await db.get(
    "SELECT user_id FROM sessions WHERE token = ? LIMIT 1",
    legacyToken
  )) as { user_id: string } | undefined;

  if (!legacySess?.user_id) unauthorized();

  const user = (await db.get(
    "SELECT id, agency_id, email, email_verified FROM users WHERE id = ? LIMIT 1",
    legacySess.user_id
  )) as AuthedUser | undefined;

  if (!user?.id || !user?.agency_id) unauthorized();

  return { user };
}
