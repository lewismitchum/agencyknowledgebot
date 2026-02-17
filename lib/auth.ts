import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET!;
const COOKIE_NAME = "louis_session";

export type Session = {
  agencyId: string;
  agencyEmail: string;

  // ✅ New (but optional for backward compatibility)
  userId?: string;
  role?: "owner" | "admin" | "member";
  status?: "active" | "pending" | "blocked";
};

// Minimal cookie header parser (no deps)
function readCookieFromHeader(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(name + "=")) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

export function signSession(payload: Session): string {
  // Keep it small & stable
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifySession(token: string): Session | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded?.agencyId || !decoded?.agencyEmail) return null;

    const s: Session = {
      agencyId: String(decoded.agencyId),
      agencyEmail: String(decoded.agencyEmail),
    };

    // ✅ Backward compatible: only attach these if present
    if (decoded.userId) s.userId = String(decoded.userId);
    if (decoded.role) s.role = (String(decoded.role).toLowerCase() as Session["role"]);
    if (decoded.status) s.status = (String(decoded.status).toLowerCase() as Session["status"]);

    // normalize role/status if provided
    if (s.role !== undefined) {
      const r = String(s.role).toLowerCase();
      s.role = r === "owner" ? "owner" : r === "admin" ? "admin" : "member";
    }
    if (s.status !== undefined) {
      const st = String(s.status).toLowerCase();
      s.status = st === "active" ? "active" : st === "blocked" ? "blocked" : "pending";
    }

    return s;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): Session | null {
  // 1) Normal Next cookie API
  let token = req.cookies.get(COOKIE_NAME)?.value;

  // 2) Fallback: raw Cookie header (needed in some Next proxy paths)
  if (!token) {
    token = readCookieFromHeader(req.headers.get("cookie"), COOKIE_NAME) || undefined;
  }

  if (!token) return null;
  return verifySession(token);
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
};
