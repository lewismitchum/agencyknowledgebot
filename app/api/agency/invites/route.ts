// app/api/agency/invites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";
import { ensureInviteTables } from "@/lib/db/ensure-invites";
import { makeToken, hashToken, isoFromNowMinutes, nowIso } from "@/lib/tokens";
import { getAppUrl, sendEmail } from "@/lib/email";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";

function pickMaxUsersFromLimits(limits: any): number | null {
  const raw = limits?.max_users ?? limits?.users ?? limits?.seats ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function getAgencyPlan(db: Db, agencyId: string, fallbackPlan: string | null) {
  const row = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan: string | null }
    | undefined;
  return normalizePlan(row?.plan ?? fallbackPlan ?? null);
}

async function countBillableSeats(db: Db, agencyId: string): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) as c
     FROM users
     WHERE agency_id = ?
       AND COALESCE(status, 'active') != 'blocked'
       AND COALESCE(role, 'member') NOT IN ('owner', 'admin')`,
    agencyId
  )) as { c: number } | undefined;

  return Number(row?.c ?? 0);
}

async function countActivePendingInvites(db: Db, agencyId: string): Promise<number> {
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
    await ensureInviteTables();
    const session = await requireOwner(req);

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

    const db: Db = await getDb();

    const existing = (await db.get(
      "SELECT id FROM users WHERE agency_id = ? AND lower(email) = ? LIMIT 1",
      session.agencyId,
      email
    )) as { id: string } | undefined;

    if (existing?.id) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    const plan = await getAgencyPlan(db, session.agencyId, (session as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
const maxUsers = limits.max_users; // null => unlimited

    if (maxUsers != null) {
      const used = await countBillableSeats(db, session.agencyId);
      const pendingInvites = await countActivePendingInvites(db, session.agencyId);

      if (used + pendingInvites >= maxUsers) {
        return NextResponse.json(
          {
            ok: false,
            error: "SEAT_LIMIT_EXCEEDED",
            plan,
            used,
            pending_invites: pendingInvites,
            limit: maxUsers,
          },
          { status: 403 }
        );
      }
    }

    const existingInvite = (await db.get(
      `SELECT id
       FROM agency_invites
       WHERE agency_id = ?
         AND lower(email) = ?
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > ?
       LIMIT 1`,
      session.agencyId,
      email,
      nowIso()
    )) as { id: string } | undefined;

    if (existingInvite?.id) {
      return NextResponse.json({ error: "Invite already sent" }, { status: 409 });
    }

    const token = makeToken();
    const token_hash = hashToken(token);
    const inviteId = randomUUID();
    const expires_at = isoFromNowMinutes(60 * 24 * 7);

    await db.run(
      `INSERT INTO agency_invites (id, agency_id, email, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      inviteId,
      session.agencyId,
      email,
      token_hash,
      expires_at,
      nowIso()
    );

    const acceptUrl = `${getAppUrl()}/accept-invite?token=${token}`;

    await sendEmail({
      to: email,
      subject: "You’ve been invited to Louis.Ai",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5">
          <h2>You’re invited</h2>
          <p>Click below to join the workspace. You’ll create your password on the next screen.</p>
          <p style="margin: 24px 0;">
            <a href="${acceptUrl}" style="background:#111;color:#fff;padding:10px 14px;border-radius:999px;text-decoration:none;display:inline-block;">
              Accept invite
            </a>
          </p>
          <p style="color:#666;font-size:12px;">This link expires in 7 days.</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureInviteTables();
    const session = await requireOwner(req);

    const body = await req.json().catch(() => ({}));
    const invite_id = String(body?.invite_id || "").trim();
    if (!invite_id) return NextResponse.json({ error: "Missing invite_id" }, { status: 400 });

    const db: Db = await getDb();

    // Only revoke invites for this agency, and only if not already accepted.
    const existing = (await db.get(
      `SELECT id, accepted_at
       FROM agency_invites
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      invite_id,
      session.agencyId
    )) as { id: string; accepted_at: string | null } | undefined;

    if (!existing?.id) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (existing.accepted_at) {
      return NextResponse.json({ error: "Invite already accepted" }, { status: 409 });
    }

    await db.run(
      `UPDATE agency_invites
       SET revoked_at = ?
       WHERE id = ? AND agency_id = ?`,
      nowIso(),
      invite_id,
      session.agencyId
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
