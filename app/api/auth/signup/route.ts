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
 * Best-effort schema patch so roles/status can exist without manual migrations.
 * Safe: if column already exists, ALTER will throw and we ignore.
 */
async function ensureUserRoleColumns(db: any) {
  try {
    await db.run("ALTER TABLE users ADD COLUMN role TEXT", []);
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN status TEXT", []);
  } catch {}
}

/**
 * Returns true if SMTP env vars appear configured.
 * We do NOT want signup to crash when SMTP is missing in production.
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
  await ensureSchema().catch(() => {});

  try {
    const { name, email, password } = await readBody(req);

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await db.get(
      "SELECT id FROM agencies WHERE email = ?",
      normalizedEmail
    );
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const agencyId = randomUUID();
    const ownerUserId = randomUUID();
    const password_hash = await bcrypt.hash(password, 10);

    // If SMTP is configured, do full verify-email flow.
    // If SMTP is NOT configured, do NOT crash — just auto-verify.
    const willSendEmail = smtpConfigured();

    let emailVerified = willSendEmail ? 0 : 1;
    let tokenHash: string | null = null;
    let expiresAt: string | null = null;
    let verifyUrl: string | null = null;

    if (willSendEmail) {
      const token = makeToken();
      tokenHash = hashToken(token);
      expiresAt = isoFromNowMinutes(60); // 1 hour
      verifyUrl = `${getAppUrl()}/verify-email?token=${token}`;
    }

    // Create agency
    await db.run(
      `INSERT INTO agencies (
        id, name, email, password_hash, vector_store_id, created_at,
        email_verified, email_verify_token_hash, email_verify_expires_at, email_verify_last_sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      agencyId,
      name.trim(),
      normalizedEmail,
      password_hash,
      null,
      nowIso(),
      emailVerified,
      tokenHash,
      expiresAt,
      willSendEmail ? nowIso() : null
    );

    // Ensure users table has role/status, then create the OWNER user row
    await ensureUserRoleColumns(db);

    await db.run(
      `INSERT INTO users (id, agency_id, email, email_verified, role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ownerUserId,
      agencyId,
      normalizedEmail,
      emailVerified,
      "owner",
      emailVerified ? "active" : "pending"
    );

    // Try to send verification email ONLY if SMTP configured.
    // If email send fails, do NOT crash signup.
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
        // Keep the account created; user can still log in after manual verification flow is fixed.
        // You can later add a "resend verification" button that works once SMTP is configured.
      }
    }

    // Response:
    // - If we sent an email, redirect to check-email.
    // - If we did not, redirect straight into the app.
    const res = willSendEmail
      ? NextResponse.redirect(new URL("/check-email", req.url))
      : NextResponse.redirect(new URL("/app/chat", req.url));

    // Session cookie is identity-only (agencyId + agencyEmail). User/role/status read server-side from DB.
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
