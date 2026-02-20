// app/api/auth/request-password-reset/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getResendClient, getEmailFrom, getAppBaseUrl } from "@/lib/resend";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

type Body = {
  email?: string;
};

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function signResetToken(payload: { kind: "agency" | "user"; email: string }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET_MISSING");

  // 60 minutes
  return jwt.sign(
    { typ: "password_reset", kind: payload.kind, email: payload.email },
    secret,
    { expiresIn: "60m" }
  );
}

async function findAccountByEmail(db: Db, email: string) {
  // Prefer agency account if it exists (since agencies has password_hash in your schema)
  const agency = (await db.get(
    `SELECT id, email FROM agencies WHERE LOWER(email) = ? LIMIT 1`,
    email
  )) as { id: string; email: string } | undefined;

  if (agency?.id) return { kind: "agency" as const, email: normalizeEmail(agency.email) };

  const user = (await db.get(
    `SELECT id, email FROM users WHERE LOWER(email) = ? LIMIT 1`,
    email
  )) as { id: string; email: string } | undefined;

  if (user?.id) return { kind: "user" as const, email: normalizeEmail(user.email) };

  return null;
}

function buildEmailHtml(resetUrl: string) {
  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
    <h2 style="margin:0 0 12px 0;">Reset your password</h2>
    <p style="margin:0 0 16px 0;">Click the button below to set a new password. This link expires in 60 minutes.</p>
    <p style="margin:0 0 20px 0;">
      <a href="${resetUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;">
        Reset password
      </a>
    </p>
    <p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;">If you didn’t request this, you can ignore this email.</p>
  </div>
  `.trim();
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as Body | null;
    const email = normalizeEmail(body?.email || "");

    if (!email) return Response.json({ error: "Missing email" }, { status: 400 });

    // Avoid account enumeration: always return ok:true
    const acct = await findAccountByEmail(db, email);
    if (!acct) return Response.json({ ok: true });

    const token = signResetToken(acct);
    const baseUrl = getAppBaseUrl();
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const resend = getResendClient();
    await resend.emails.send({
      from: getEmailFrom(),
      to: acct.email,
      subject: "Reset your Louis.Ai password",
      html: buildEmailHtml(resetUrl),
    });

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    // If Resend env missing, surface clean error for you in prod logs
    if (msg === "RESEND_API_KEY_MISSING" || msg === "RESEND_FROM_MISSING" || msg === "JWT_SECRET_MISSING") {
      return Response.json({ error: msg }, { status: 500 });
    }

    console.error("REQUEST_PASSWORD_RESET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}