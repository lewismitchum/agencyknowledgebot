// app/api/accept-invite/route.ts
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb, type Db } from "@/lib/db";
import { ensureInviteTables } from "@/lib/db/ensure-invites";
import { hashToken, nowIso } from "@/lib/tokens";
import { setSessionCookie } from "@/lib/session";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sendWelcomeEmailSafe } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureUserAuthColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER").catch(() => {});
}

function pickMaxUsersFromLimits(limits: any): number | null {
  const raw = limits?.max_users ?? limits?.users ?? limits?.seats ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function countActiveBillableSeatsTx(db: Db, agencyId: string): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) as c
     FROM users
     WHERE agency_id = ?
       AND COALESCE(status,'active') = 'active'
       AND COALESCE(role,'member') NOT IN ('owner','admin')`,
    agencyId
  )) as { c: number } | undefined;

  return Number(row?.c ?? 0);
}

async function countActivePendingInvitesTx(db: Db, agencyId: string): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) as c
     FROM agency_invites
     WHERE agency_id = ?
       AND accepted_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > ?`,
    agencyId,
    nowIso()
  )) as { c: number } | undefined;

  return Number(row?.c ?? 0);
}

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    try {
      await enforceRateLimit({
        userId: `ip:${ip}`,
        agencyId: "public",
        key: "accept_invite",
        perMinute: 10,
        perHour: 200,
      });
    } catch {
      return NextResponse.json({ ok: false, error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
    }

    await ensureInviteTables();

    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const password = String(body?.password || "").trim();

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ error: "Missing password" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserAuthColumns(db);

    const token_hash = hashToken(token);

    await db.run("BEGIN IMMEDIATE TRANSACTION");

    let welcomeTo: string | null = null;
    let welcomeAgencyName: string | null = null;

    try {
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
        await db.run("ROLLBACK");
        return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
      }

      const exp = invite.expires_at ? new Date(invite.expires_at).getTime() : 0;
      if (!exp || Date.now() > exp) {
        await db.run("ROLLBACK");
        return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
      }

      const agency = (await db.get(
        `SELECT id, email, name, plan
         FROM agencies
         WHERE id = ?
         LIMIT 1`,
        invite.agency_id
      )) as { id: string; email: string; name: string | null; plan: string | null } | undefined;

      if (!agency?.id) {
        await db.run("ROLLBACK");
        return NextResponse.json({ error: "Invalid invite (agency missing)" }, { status: 400 });
      }

      const emailLower = String(invite.email || "").trim().toLowerCase();
      if (!emailLower) {
        await db.run("ROLLBACK");
        return NextResponse.json({ error: "Invalid invite (email missing)" }, { status: 400 });
      }

      const existing = (await db.get(
        "SELECT id FROM users WHERE agency_id = ? AND lower(email) = ? LIMIT 1",
        invite.agency_id,
        emailLower
      )) as { id: string } | undefined;

      if (existing?.id) {
        await db.run("ROLLBACK");
        return NextResponse.json({ error: "User already exists" }, { status: 409 });
      }

      const plan = normalizePlan(agency.plan);
      const limits = getPlanLimits(plan);
      const maxUsers = pickMaxUsersFromLimits(limits);

      if (maxUsers != null) {
        const usedActiveBillable = await countActiveBillableSeatsTx(db, invite.agency_id);
        const pendingInvites = await countActivePendingInvitesTx(db, invite.agency_id);

        if (usedActiveBillable + pendingInvites >= Number(maxUsers)) {
          await db.run("ROLLBACK");
          return NextResponse.json(
            {
              ok: false,
              error: "SEAT_LIMIT_EXCEEDED",
              plan,
              used: usedActiveBillable,
              pending_invites: pendingInvites,
              limit: Number(maxUsers),
            },
            { status: 403 }
          );
        }
      }

      const userId = randomUUID();
      const password_hash = await bcrypt.hash(password, 10);
      const ts = nowIso();

      await db.run(
        `INSERT INTO users (id, agency_id, email, email_verified, role, status, has_completed_onboarding, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        invite.agency_id,
        emailLower,
        1,
        "member",
        "active",
        0,
        password_hash,
        ts,
        ts
      );

      await db.run(`UPDATE agency_invites SET accepted_at = ? WHERE id = ?`, ts, invite.id);

      welcomeTo = emailLower;
      welcomeAgencyName = agency.name;

      await db.run("COMMIT");

      if (welcomeTo) {
        void sendWelcomeEmailSafe({ to: welcomeTo, agencyName: welcomeAgencyName });
      }

      const res = NextResponse.json({
        ok: true,
        redirectTo: "/app/chat",
        agencyName: agency.name ?? undefined,
      });

      setSessionCookie(res, {
        agencyId: agency.id,
        agencyEmail: agency.email,
        userId,
        userEmail: emailLower,
      });

      return res;
    } catch (inner) {
      await db.run("ROLLBACK");
      throw inner;
    }
  } catch (err: any) {
    console.error("ACCEPT_INVITE_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}