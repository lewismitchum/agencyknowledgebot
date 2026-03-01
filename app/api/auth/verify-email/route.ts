// app/api/auth/verify-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { hashToken } from "@/lib/tokens";
import { sendWelcomeEmailSafe } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureUserRoleColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
}

async function verifyTokenAndActivate(db: Db, token: string) {
  const t = String(token || "").trim();
  if (!t) return { ok: false as const, status: 400, error: "Missing token" };

  const tokenHash = hashToken(t);

  const agency = (await db.get(
    `SELECT id, name, email, email_verify_expires_at, email_verified
     FROM agencies
     WHERE email_verify_token_hash = ?
     LIMIT 1`,
    tokenHash
  )) as
    | {
        id: string;
        name: string;
        email: string;
        email_verify_expires_at: string | null;
        email_verified: number;
      }
    | undefined;

  if (!agency?.id) {
    return { ok: false as const, status: 400, error: "Invalid or expired link" };
  }

  const exp = agency.email_verify_expires_at ? new Date(agency.email_verify_expires_at).getTime() : 0;

  let justVerified = false;

  if (!agency.email_verified) {
    if (!exp || Date.now() > exp) {
      return { ok: false as const, status: 400, error: "Invalid or expired link" };
    }

    await db.run(
      `UPDATE agencies
       SET email_verified = 1,
           email_verify_token_hash = NULL,
           email_verify_expires_at = NULL
       WHERE id = ?`,
      agency.id
    );

    justVerified = true;
  }

  // Always ensure owner identity is active (idempotent)
  await db.run(
    `UPDATE users
     SET email_verified = 1,
         role = coalesce(role, 'owner'),
         status = 'active'
     WHERE agency_id = ? AND lower(email) = lower(?)`,
    agency.id,
    agency.email
  );

  if (justVerified) {
    void sendWelcomeEmailSafe({
      to: agency.email,
      agencyName: agency.name,
    });
  }

  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") || "";
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserRoleColumns(db);

    const out = await verifyTokenAndActivate(db, token);
    if (!out.ok) {
      return NextResponse.redirect(new URL(`/verify-email?error=${encodeURIComponent(out.error)}`, req.url));
    }

    // Verified -> send them into the app.
    return NextResponse.redirect(new URL("/app", req.url));
  } catch (err: any) {
    console.error("VERIFY_EMAIL_GET_ERROR", err);
    return NextResponse.redirect(new URL("/verify-email?error=server_error", req.url));
  }
}

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json().catch(() => ({}));
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserRoleColumns(db);

    const out = await verifyTokenAndActivate(db, String(token || ""));
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("VERIFY_EMAIL_POST_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}