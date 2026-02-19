// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { makeToken, hashToken, isoFromNowMinutes, nowIso } from "@/lib/tokens";
import { getAppUrl, sendEmail } from "@/lib/email";
import { setSessionCookie } from "@/lib/session";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return { name: j?.name, email: j?.email, password: j?.password };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    name: params.get("name"),
    email: params.get("email"),
    password: params.get("password"),
  };
}

/**
 * Returns true if SMTP env vars appear configured.
 * Signup must NEVER crash if email is unavailable.
 */
function smtpConfigured() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  return Boolean(host && port && user && pass && from);
}

export async function POST(req: NextRequest) {
  try {
    // 🔒 Canonical schema guarantee
    await ensureSchema();

    const { name, email, password } = await readBody(req);

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();

    // Enforce unique agency email
    const existing = await db.get<{ id: string }>(
      "SELECT id FROM agencies WHERE lower(email) = ? LIMIT 1",
      normalizedEmail
    );
    if (existing?.id) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const agencyId = randomUUID();
    const ownerUserId = randomUUID();
    const password_hash = await bcrypt.hash(password, 10);

    // Email verification strategy
    const willSendEmail = smtpConfigured();
    const emailVerified = willSendEmail ? 0 : 1;

    let tokenHash: string | null = null;
    let expiresAt: string | null = null;
    let verifyUrl: string | null = null;

    if (willSendEmail) {
      const token = makeToken();
      tokenHash = hashToken(token);
      expiresAt = isoFromNowMinutes(60);
      verifyUrl = `${getAppUrl()}/verify-email?token=${token}`;
    }

    // Create agency (canonical columns only)
    await db.run(
      `INSERT INTO agencies (
        id,
        name,
        email,
        password_hash,
        plan,
        email_verified,
        email_verify_token_hash,
        email_verify_expires_at,
        email_verify_last_sent_at,
        created_at
      ) VALUES (?, ?, ?, ?, 'free', ?, ?, ?, ?, ?)`,
      agencyId,
      name.trim(),
      normalizedEmail,
      password_hash,
      emailVerified,
      tokenHash,
      expiresAt,
      willSendEmail ? nowIso() : null,
      nowIso()
    );

    // Create OWNER user row (schema already guaranteed)
    await db.run(
      `INSERT INTO users (
        id,
        agency_id,
        email,
        email_verified,
        role,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ownerUserId,
      agencyId,
      normalizedEmail,
      emailVerified,
      "owner",
      emailVerified ? "active" : "pending",
      nowIso(),
      nowIso()
    );

    // Best-effort email send (never fatal)
    if (willSendEmail && verifyUrl) {
      try {
        await sendEmail({
          to: normalizedEmail,
          subject: "Verify your email for Louis.Ai",
          html: `
            <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5">
              <h2>Verify your email</h2>
              <p>Click the button below to verify your email and activate your workspace.</p>
              <p style="margin: 24px 0;">
                <a href="${verifyUrl}" style="background:#111;color:#fff;padding:10px 14px;border-radius:999px;text-decoration:none;display:inline-block;">
                  Verify email
                </a>
              </p>
              <p style="color:#666;font-size:12px;">This link expires in 60 minutes.</p>
            </div>
          `,
        });
      } catch (e) {
        console.error("SIGNUP_EMAIL_SEND_FAILED", e);
      }
    }

    const res = willSendEmail
      ? NextResponse.redirect(new URL("/check-email", req.url))
      : NextResponse.redirect(new URL("/app/chat", req.url));

    // 🔐 Identity-only session
    setSessionCookie(res, {
      agencyId,
      agencyEmail: normalizedEmail,
    });

    return res;
  } catch (err: any) {
    console.error("SIGNUP_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
