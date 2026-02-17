// app/api/agency/users/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";
import { ensureInviteTables } from "@/lib/db/ensure-invites";
import { nowIso } from "@/lib/tokens";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";

type UserRow = {
  id: string;
  email: string;
  role: string | null;
  status: string | null;
  created_at: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  created_at: string | null;
  expires_at: string | null;
};

async function ensureRoleStatusColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
}

function normalizeRole(raw: unknown): "owner" | "admin" | "member" {
  const v = String(raw ?? "").toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function normalizeStatus(raw: unknown): "active" | "pending" | "blocked" {
  const v = String(raw ?? "").toLowerCase();
  if (v === "active") return "active";
  if (v === "blocked") return "blocked";
  // safest default: pending (forces explicit approval)
  return "pending";
}

function pickMaxUsersFromLimits(limits: any): number | null {
  const raw = limits?.max_users ?? limits?.users ?? limits?.seats ?? null;
  if (raw == null) return null; // unlimited or not configured
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function getAgencyPlan(db: Db, agencyId: string, fallbackPlan: string | null) {
  const row = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan: string | null }
    | undefined;
  return normalizePlan(row?.plan ?? fallbackPlan ?? null);
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);

    const db: Db = await getDb();
    await ensureRoleStatusColumns(db);
    await ensureInviteTables();

    // Plan + seat limits
    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
    const maxUsers = pickMaxUsersFromLimits(limits);

    // Users
    const users = (await db.all(
      `SELECT id, email, role, status, created_at
       FROM users
       WHERE agency_id = ?
       ORDER BY created_at DESC`,
      ctx.agencyId
    )) as UserRow[];

    // Self-heal: backfill missing role/status so old rows don't bypass approvals.
    for (const u of users) {
      const role = normalizeRole(u.role);
      const status = normalizeStatus(u.status);

      const needsRole = u.role == null || u.role === "";
      const needsStatus = u.status == null || u.status === "";

      if (needsRole || needsStatus) {
        await db.run(
          `UPDATE users
           SET role = COALESCE(NULLIF(role, ''), ?),
               status = COALESCE(NULLIF(status, ''), ?)
           WHERE id = ? AND agency_id = ?`,
          role,
          status,
          u.id,
          ctx.agencyId
        );
        u.role = role;
        u.status = status;
      }
    }

    const normalizedUsers = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: normalizeRole(u.role),
      status: normalizeStatus(u.status),
      created_at: u.created_at,
    }));

    // Billable seats used (exclude owner/admin, ignore blocked)
    const billableUsed = normalizedUsers.filter(
      (u) => u.status !== "blocked" && u.role !== "owner" && u.role !== "admin"
    ).length;

    // Pending invites (unaccepted, unrevoked, unexpired)
    const invites = (await db.all(
      `SELECT id, email, created_at, expires_at
       FROM agency_invites
       WHERE agency_id = ?
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY created_at DESC`,
      ctx.agencyId,
      nowIso()
    )) as InviteRow[];

    const pendingInvites = (invites ?? []).map((i) => ({
      id: i.id,
      email: String(i.email ?? ""),
      created_at: i.created_at,
      expires_at: i.expires_at,
    }));

    return NextResponse.json({
      ok: true,
      plan,
      seats: {
        used: billableUsed,
        pending_invites: pendingInvites.length,
        limit: maxUsers, // null => unlimited
      },
      users: normalizedUsers,
      invites: pendingInvites,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_OWNER" }, { status: 403 });
    }

    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: msg }, { status: 500 });
  }
}
