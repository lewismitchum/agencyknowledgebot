// app/api/auth/reset-password/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

type Body = {
  token?: string;
  new_password?: string;
};

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function verifyResetToken(token: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET_MISSING");

  const decoded = jwt.verify(token, secret) as any;

  if (!decoded || decoded.typ !== "password_reset") throw new Error("INVALID_TOKEN");
  if (decoded.kind !== "agency" && decoded.kind !== "user") throw new Error("INVALID_TOKEN");
  if (!decoded.email) throw new Error("INVALID_TOKEN");

  return { kind: decoded.kind as "agency" | "user", email: normalizeEmail(decoded.email) };
}

function validatePassword(pw: string) {
  const s = String(pw || "");
  if (s.length < 10) return "Password must be at least 10 characters.";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as Body | null;
    const token = String(body?.token || "").trim();
    const newPassword = String(body?.new_password || "");

    if (!token) return Response.json({ error: "Missing token" }, { status: 400 });
    if (!newPassword) return Response.json({ error: "Missing new_password" }, { status: 400 });

    const pwErr = validatePassword(newPassword);
    if (pwErr) return Response.json({ error: pwErr }, { status: 400 });

    let payload: { kind: "agency" | "user"; email: string };
    try {
      payload = verifyResetToken(token);
    } catch (e: any) {
      const m = String(e?.message ?? e);
      if (m === "TokenExpiredError") return Response.json({ error: "TOKEN_EXPIRED" }, { status: 400 });
      return Response.json({ error: "INVALID_TOKEN" }, { status: 400 });
    }

    const password_hash = await bcrypt.hash(newPassword, 12);

    if (payload.kind === "agency") {
      await db.run(`UPDATE agencies SET password_hash = ? WHERE LOWER(email) = ?`, password_hash, payload.email);
    } else {
      // If your users table stores password hash under a different column name, rename this here.
      await db.run(`UPDATE users SET password_hash = ? WHERE LOWER(email) = ?`, password_hash, payload.email);
    }

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "JWT_SECRET_MISSING") return Response.json({ error: msg }, { status: 500 });

    console.error("RESET_PASSWORD_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}