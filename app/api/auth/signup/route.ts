// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { makeToken, hashToken, isoFromNowMinutes, nowIso } from "@/lib/tokens";
import { getAppUrl, sendEmail, sendWelcomeEmailSafe } from "@/lib/email";
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
      invite: j?.invite,
      invite_token: j?.invite_token,
      next: j?.next,
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
    invite: params.get("invite"),
    invite_token: params.get("invite_token"),
    next: params.get("next"),
    isJson: false as const,
  };
}

async function ensureUserRoleColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER").catch(() => {});
}

function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
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

function normName(s: string) {
  return String(s ?? "").trim();
}

function normEmail(s: string) {
  return String(s ?? "").trim().toLowerCase();
}

function normNext(s: any) {
  const v = String(s ?? "").trim();
  if (!v) return "/app";
  // basic safety: only allow internal paths
  if (!v.startsWith("/")) return "/app";
  if (v.startsWith("//")) return "/app";
  return v;
}

function isInviteMode(invite: any, invite_token: any) {
  const flag = String(invite ?? "").trim();
  const tok = String(invite_token ?? "").trim();
  return flag === "1" || flag.toLowerCase() === "true" || !!tok;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/auth/signup",
    methods: ["GET", "POST"],
    has_email: resendConfigured(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserRoleColumns(db);

    const { name, email, password, turnstile_token, invite, invite_token, next, isJson } = await readBody(req);

    const agencyName = normName(name);
    const normalizedEmail = normEmail(email);
    const rawPassword = String(password ?? "").trim();
    const nextPath = normNext(next);

    const inviteMode = isInviteMode(invite, invite_token);

    // For invite mode, agencyName is not required.
    if ((!inviteMode && !agencyName) || !normalizedEmail || !rawPassword) {
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

    // =========================
    // INVITE SIGNUP (SET PASSWORD FOR EXISTING INVITED USER)
    // =========================
    if (inviteMode) {
      const existing = (await db.get(
        `SELECT id, agency_id, status, role, password_hash, email_verified
         FROM users
         WHERE lower(email) = lower(?)
         LIMIT 1`,
        normalizedEmail
      )) as
        | {
            id: string;
            agency_id: string;
            status: string | null;
            role: string | null;
            password_hash: string | null;
            email_verified: number | null;
          }
        | undefined;

      if (!existing?.id) {
        return NextResponse.json(
          { error: "Invite not found for this email. Ask the owner/admin to resend the invite link." },
          { status: 404 }
        );
      }

      const status = String(existing.status ?? "active").toLowerCase();
      if (status === "blocked") {
        return NextResponse.json({ error: "Account blocked" }, { status: 403 });
      }

      // If they already have a password, this is an existing account.
      const alreadyHasPassword = !!String(existing.password_hash ?? "").trim();
      if (alreadyHasPassword) {
        const redirectTo = `/login?email=${encodeURIComponent(normalizedEmail)}&next=${encodeURIComponent(nextPath)}`;
        if (isJson) return NextResponse.json({ ok: true, mode: "invite_existing_account", redirectTo });
        return NextResponse.redirect(new URL(redirectTo, req.url));
      }

      const password_hash = await bcrypt.hash(rawPassword, 10);

      // Invited users should be ACTIVE immediately and considered email-verified (invite email is proof of control).
      await db.run(
        `UPDATE users
         SET password_hash = ?,
             status = 'active',
             role = COALESCE(NULLIF(role,''), 'member'),
             email_verified = 1,
             updated_at = ?
         WHERE id = ?`,
        password_hash,
        nowIso(),
        existing.id
      );

      const agencyRow = (await db.get(
        `SELECT email, name
         FROM agencies
         WHERE id = ?
         LIMIT 1`,
        existing.agency_id
      )) as { email?: string | null; name?: string | null } | undefined;

      const agencyEmail = String(agencyRow?.email ?? "").trim() || normalizedEmail;
      const agencyDisplayName = String(agencyRow?.name ?? "").trim() || null;

      // Non-blocking welcome
      if (agencyDisplayName) {
        void sendWelcomeEmailSafe({ to: normalizedEmail, agencyName: agencyDisplayName });
      }

      if (isJson) {
        const res = NextResponse.json({ ok: true, mode: "invite_set_password", redirectTo: nextPath });
        setSessionCookie(res, {
          agencyId: existing.agency_id,
          agencyEmail,
          userId: existing.id,
          userEmail: normalizedEmail,
        });
        return res;
      }

      const res = NextResponse.redirect(new URL(nextPath, req.url));
      setSessionCookie(res, {
        agencyId: existing.agency_id,
        agencyEmail,
        userId: existing.id,
        userEmail: normalizedEmail,
      });
      return res;
    }

    // =========================
    // NORMAL SIGNUP (CURRENT BEHAVIOR)
    // =========================

    // Safety: block if email is already used as an agency login anywhere
    const existingAgencyByEmail = (await db.get(
      "SELECT id FROM agencies WHERE lower(email) = ? LIMIT 1",
      normalizedEmail
    )) as { id: string } | undefined;

    if (existingAgencyByEmail?.id) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    // Block if this email already exists as a user in ANY agency
    const existingUserAnywhere = (await db.get(
      "SELECT id FROM users WHERE lower(email) = ? LIMIT 1",
      normalizedEmail
    )) as { id: string } | undefined;

    if (existingUserAnywhere?.id) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    // If agency name already exists => join flow (pending approval)
    const existingAgencyByName = (await db.get(
      `SELECT id, name, email
       FROM agencies
       WHERE lower(name) = lower(?)
       LIMIT 1`,
      agencyName
    )) as { id: string; name: string | null; email: string | null } | undefined;

    const password_hash = await bcrypt.hash(rawPassword, 10);

    const willSendEmail = resendConfigured();
    const emailVerified = willSendEmail ? 0 : 1;

    let tokenHash: string | null = null;
    let expiresAt: string | null = null;
    let verifyUrl: string | null = null;

    if (willSendEmail) {
      const token = makeToken();
      tokenHash = hashToken(token);
      expiresAt = isoFromNowMinutes(60);
      const tokenParam = encodeURIComponent(token);
      verifyUrl = `${getAppUrl()}/verify-email?token=${tokenParam}`;
    }

    // JOIN EXISTING AGENCY (PENDING)
    if (existingAgencyByName?.id) {
      const agencyId = String(existingAgencyByName.id);
      const newUserId = randomUUID();

      await db.run(
        `INSERT INTO users (id, agency_id, email, email_verified, role, status, has_completed_onboarding, created_at, updated_at, password_hash)
         VALUES (?, ?, ?, ?, 'member', 'pending', 0, ?, ?, ?)`,
        newUserId,
        agencyId,
        normalizedEmail,
        emailVerified,
        nowIso(),
        nowIso(),
        password_hash
      );

      if (willSendEmail && verifyUrl) {
        try {
          await sendEmail({
            to: normalizedEmail,
            subject: "Verify your email for Louis.Ai",
            html: `
              <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5">
                <h2>Verify your email</h2>
                <p>Click the button below to verify your email address.</p>
                <p>After verification, your request will still need approval by the agency owner/admin.</p>
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
          console.error("JOIN_VERIFY_EMAIL_SEND_FAILED", e);
        }
      }

      const redirectTo = "/pending-approval";

      if (isJson) {
        return NextResponse.json({
          ok: true,
          mode: "join_existing_agency",
          agencyId,
          redirectTo,
        });
      }

      return NextResponse.redirect(new URL(redirectTo, req.url));
    }

    // CREATE NEW AGENCY (OWNER)
    const agencyId = randomUUID();
    const ownerUserId = randomUUID();

    await db.run(
      `INSERT INTO agencies (
        id, name, email, password_hash, vector_store_id, created_at,
        email_verified, email_verify_token_hash, email_verify_expires_at, email_verify_last_sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      agencyId,
      agencyName,
      normalizedEmail,
      password_hash,
      null,
      nowIso(),
      emailVerified,
      tokenHash,
      expiresAt,
      willSendEmail ? nowIso() : null
    );

    await db.run(
      `INSERT INTO users (id, agency_id, email, email_verified, role, status, has_completed_onboarding, created_at, updated_at, password_hash)
       VALUES (?, ?, ?, ?, 'owner', ?, 0, ?, ?, ?)`,
      ownerUserId,
      agencyId,
      normalizedEmail,
      emailVerified,
      emailVerified ? "active" : "pending",
      nowIso(),
      nowIso(),
      password_hash
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

    if (emailVerified) {
      void sendWelcomeEmailSafe({ to: normalizedEmail, agencyName });
    }

    const redirectTo = willSendEmail ? "/check-email" : "/app/chat";

    if (emailVerified) {
      if (isJson) {
        const res = NextResponse.json({ ok: true, mode: "new_agency", redirectTo });
        setSessionCookie(res, {
          agencyId,
          agencyEmail: normalizedEmail,
          userId: ownerUserId,
          userEmail: normalizedEmail,
        });
        return res;
      }

      const res = NextResponse.redirect(new URL(redirectTo, req.url));
      setSessionCookie(res, {
        agencyId,
        agencyEmail: normalizedEmail,
        userId: ownerUserId,
        userEmail: normalizedEmail,
      });
      return res;
    }

    if (isJson) {
      return NextResponse.json({ ok: true, mode: "new_agency", redirectTo });
    }

    return NextResponse.redirect(new URL(redirectTo, req.url));
  } catch (err: any) {
    console.error("SIGNUP_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}