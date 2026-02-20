// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { makeToken, hashToken, isoFromNowMinutes, nowIso } from "@/lib/tokens";
import { getAppUrl, sendEmail } from "@/lib/email";
import { setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return {
      name: j?.name,
      email: j?.email,
      password: j?.password,
      turnstile_token: j?.turnstile_token,
      isJson: true as const,
    };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return {
    name: params.get("name"),
    email: params.get("email"),
    password: params.get("password"),
    turnstile_token: params.get("turnstile_token"),
    isJson: false as const,
  };
}

async function ensureUserRoleColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
}

function resendConfigured() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  return Boolean(key && from);
}

async function verifyTurnstile(token: string, ip: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false as const, error: "TURNSTILE_SECRET_MISSING" };
  if (!token) return { ok: false as const, error: "TURNSTILE_REQUIRED" };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const j = (await r.json().catch(() => null)) as any;
  if (j && j.success) return { ok: true as const };
  return { ok: false as const, error: "TURNSTILE_FAILED", details: j ?? null };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/auth/signup",
    methods: ["GET", "POST"],
    has_resend: resendConfigured(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);

    const { name, email, password, turnstile_token, isJson } = await readBody(req);

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    const ts = await verifyTurnstile(String(turnstile_token || ""), ip);
    if (!ts.ok) {
      return NextResponse.json({ error: ts.error }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = (await db.get(
      "SELECT id FROM agencies WHERE lower(email) = ? LIMIT 1",
      normalizedEmail
    )) as { id: string } | undefined;

    if (existing?.id) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const agencyId = randomUUID();
    const ownerUserId = randomUUID();
    const password_hash = await bcrypt.hash(password, 10);

    const willSendEmail = resendConfigured();
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

    await ensureUserRoleColumns(db);

    await db.run(
      `INSERT INTO users (id, agency_id, email, email_verified, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', ?, ?, ?)`,
      ownerUserId,
      agencyId,
      normalizedEmail,
      emailVerified,
      emailVerified ? "active" : "pending",
      nowIso(),
      nowIso()
    );

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

    const redirectTo = willSendEmail ? "/check-email" : "/app/chat";

    if (isJson) {
      const res = NextResponse.json({ ok: true, redirectTo });
      setSessionCookie(res, { agencyId, agencyEmail: normalizedEmail });
      return res;
    }

    const res = NextResponse.redirect(new URL(redirectTo, req.url));
    setSessionCookie(res, { agencyId, agencyEmail: normalizedEmail });
    return res;
  } catch (err: any) {
    console.error("SIGNUP_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}