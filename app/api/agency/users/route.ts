// app/api/agency/users/update/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwnerOrAdmin } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { nowIso } from "@/lib/tokens";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

type Body = {
  user_id?: string;
  status?: "pending" | "active" | "blocked";
  role?: "owner" | "admin" | "member";
};

async function ensureUserRoleColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
}

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
       AND COALESCE(status,'active') != 'blocked'
       AND COALESCE(role,'member') NOT IN ('owner','admin')`,
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

function isBillable(role: string, status: string) {
  const r = String(role || "member").toLowerCase();
  const s = String(status || "pending").toLowerCase();
  if (s === "blocked") return false;
  return r === "member"; // only members count toward seats
}

function normalizeRole(raw: any): "owner" | "admin" | "member" {
  const v = String(raw ?? "").toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function normalizeStatus(raw: any): "active" | "pending" | "blocked" {
  const v = String(raw ?? "").toLowerCase();
  if (v === "active") return "active";
  if (v === "blocked") return "blocked";
  return "pending";
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwnerOrAdmin(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUserRoleColumns(db);

    const body = (await req.json().catch(() => ({}))) as Body;

    const user_id = String(body.user_id || "").trim();
    const status = body.status;
    const role = body.role;

    if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    if (status !== "pending" && status !== "active" && status !== "blocked") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (role !== "owner" && role !== "admin" && role !== "member") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Never let anyone edit themselves into a lockout state
    if (user_id === ctx.userId) {
      if (ctx.role !== "owner") {
        return NextResponse.json({ error: "You cannot change your own access." }, { status: 400 });
      }
      if (status !== "active" || role !== "owner") {
        return NextResponse.json({ error: "You cannot change your own access." }, { status: 400 });
      }
    }

    const target = (await db.get(
      `SELECT id, COALESCE(role,'member') as role, COALESCE(status,'pending') as status
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      user_id,
      ctx.agencyId
    )) as { id: string; role: string; status: string } | undefined;

    if (!target?.id) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const beforeRole = normalizeRole(target.role);
    const beforeStatus = normalizeStatus(target.status);

    const afterRole = normalizeRole(role);
    const afterStatus = normalizeStatus(status);

    // Protect owner: only owner can modify the owner user row
    if (beforeRole === "owner" && ctx.role !== "owner") {
      return NextResponse.json({ error: "Owner only" }, { status: 403 });
    }

    // Ownership transfer is owner-only
    if (afterRole === "owner" && ctx.role !== "owner") {
      return NextResponse.json({ error: "Owner only" }, { status: 403 });
    }

    // Seat safety: if this update would increase billable seats, enforce max_users
    const beforeBillable = isBillable(beforeRole, beforeStatus);
    const afterBillable = isBillable(afterRole, afterStatus);

    if (!beforeBillable && afterBillable) {
      const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
      const limits = getPlanLimits(plan);
      const maxUsers = pickMaxUsersFromLimits(limits);

      if (maxUsers != null) {
        const used = await countBillableSeats(db, ctx.agencyId);
        const pendingInvites = await countActivePendingInvites(db, ctx.agencyId);

        if (used + pendingInvites >= Number(maxUsers)) {
          return NextResponse.json(
            {
              ok: false,
              error: "SEAT_LIMIT_EXCEEDED",
              code: "SEAT_LIMIT_EXCEEDED",
              plan,
              used,
              pending_invites: pendingInvites,
              limit: Number(maxUsers),
            },
            { status: 403 }
          );
        }
      }
    }

    await db.run(
      `UPDATE users
       SET status = ?, role = ?
       WHERE id = ? AND agency_id = ?`,
      afterStatus,
      afterRole,
      user_id,
      ctx.agencyId
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_ADMIN_OR_OWNER") return NextResponse.json({ error: "Owner/Admin only" }, { status: 403 });

    console.error("AGENCY_USERS_UPDATE_ERROR", err);
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}