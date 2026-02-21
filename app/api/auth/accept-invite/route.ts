// app/api/auth/accept-invite/route.ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureInviteTables } from "@/lib/db/ensure-invites";
import { hashToken, nowIso } from "@/lib/tokens";
import { setSessionCookie } from "@/lib/session";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";

async function ensureUserAuthColumns(db: Db) {
  // Best-effort schema patching (legacy drift).
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
}

async function getAgencyPlan(db: Db, agencyId: string) {
  const row = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan?: string | null }
    | undefined;
  return normalizePlan(row?.plan ?? null);
}

// max_users counts billable members only (exclude owner/admin)
async function countBillableMembers(db: Db, agencyId: string) {
  const row = (await db.get(
    `SELECT COUNT(*) as c
     FROM users
     WHERE agency_id = ?
       AND (role IS NULL OR role NOT IN ('owner','admin'))`,
    agencyId
  )) as { c: number } | undefined;

  return Number(row?.c ?? 0);
}

export async function POST(req: NextRequest) {
  try {
    await ensureInviteTables();

    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const password = String(body?.password || "").trim();

    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
    if (!password) return NextResponse.json({ error: "Missing password" }, { status: 400 });
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserAuthColumns(db);

    const token_hash = hashToken(token);

    const invite = (await db.get(
      `SELECT id, agency_id, email, expires_at, accepted_at, revoked_at
       FROM agency_invites
       WHERE token_hash = ?
       LIMIT 1`,
      token_hash
    )) as
      | {
          id: string;
          agency_id: string;
          email: string;
          expires_at: string;
          accepted_at: string | null;
          revoked_at: string | null;
        }
      | undefined;

    if (!invite?.id || invite.revoked_at || invite.accepted_at) {
      return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
    }

    const exp = invite.expires_at ? new Date(invite.expires_at).getTime() : 0;
    if (!exp || Date.now() > exp) {
      return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
    }

    const agency = (await db.get(`SELECT id, email, plan FROM agencies WHERE id = ? LIMIT 1`, invite.agency_id)) as
      | { id: string; email: string; plan: string | null }
      | undefined;

    if (!agency?.id) {
      return NextResponse.json({ error: "Invalid invite (agency missing)" }, { status: 400 });
    }

    const emailLower = String(invite.email || "").trim().toLowerCase();
    if (!emailLower) {
      return NextResponse.json({ error: "Invalid invite (email missing)" }, { status: 400 });
    }

    // Prevent duplicates
    const existing = (await db.get(
      "SELECT id FROM users WHERE agency_id = ? AND lower(email) = ? LIMIT 1",
      invite.agency_id,
      emailLower
    )) as { id: string } | undefined;

    if (existing?.id) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    // Enforce max_users BEFORE inserting
    const plan = normalizePlan(agency.plan);
    const limits = getPlanLimits(plan);
    const maxUsers = limits.max_users;

    if (maxUsers != null) {
      const used = await countBillableMembers(db, invite.agency_id);
      if (used >= Number(maxUsers)) {
        return NextResponse.json(
          {
            error: "USER_LIMIT_EXCEEDED",
            code: "USER_LIMIT_EXCEEDED",
            plan,
            used,
            limit: Number(maxUsers),
          },
          { status: 403 }
        );
      }
    }

    const userId = randomUUID();
    const password_hash = await bcrypt.hash(password, 10);
    const ts = nowIso();

    // Invited users become PENDING by default (owner approves later).
    await db.run(
      `INSERT INTO users (id, agency_id, email, email_verified, role, status, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      invite.agency_id,
      emailLower,
      1,
      "member",
      "pending",
      password_hash,
      ts,
      ts
    );

    await db.run(`UPDATE agency_invites SET accepted_at = ? WHERE id = ?`, ts, invite.id);

    // Auto-login after accepting invite (they’ll be blocked until approved).
    const res = NextResponse.json({ ok: true, redirectTo: "/app/chat" });
    setSessionCookie(res, {
      agencyId: agency.id,
      agencyEmail: agency.email,
    });

    return res;
  } catch (err: any) {
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}