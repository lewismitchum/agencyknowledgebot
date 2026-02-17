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

export async function POST(req: NextRequest) {
  // keep: harmless if you already call it elsewhere; also ensures tables exist in fresh deploys
  await ensureSchema().catch(() => {});

  const { name, email, password } = await readBody(req);

  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db.get("SELECT id FROM agencies WHERE email = ?", normalizedEmail);
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const agencyId = randomUUID();
  const ownerUserId = randomUUID();
  const password_hash = await bcrypt.hash(password, 10);

  // Email verification token
  const token = makeToken();
  const tokenHash = hashToken(token);
  const expiresAt = isoFromNowMinutes(60); // 1 hour

  // Create agency (email not verified yet)
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
    0,
    tokenHash,
    expiresAt,
    nowIso()
  );

  // Ensure users table has role/status, then create the OWNER user row
  await ensureUserRoleColumns(db);

  // NOTE: This user represents the agency owner identity.
  // They are "pending" until email verification is complete.
  await db.run(
    `INSERT INTO users (id, agency_id, email, email_verified, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ownerUserId,
    agencyId,
    normalizedEmail,
    0,
    "owner",
    "pending"
  );

  const verifyUrl = `${getAppUrl()}/verify-email?token=${token}`;

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

  // Redirect to check-email screen
  const res = NextResponse.redirect(new URL("/check-email", req.url));

  // ✅ Session cookie is identity-only (agencyId + agencyEmail). User/role/status are read server-side from DB.
  setSessionCookie(res, {
    agencyId,
    agencyEmail: normalizedEmail,
  });

  return res;
}
