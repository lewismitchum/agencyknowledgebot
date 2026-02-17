// app/api/agency/users/update/route.ts
import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { nowIso } from "@/lib/tokens";

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

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);
    const db: Db = await getDb();
    await ensureUserRoleColumns(db);

    const body = (await req.json().catch(() => ({}))) as Body;

    const user_id = String(body.user_id || "").trim();
    const status = body.status;
    const role = body.role;

    if (!user_id) return Response.json({ error: "Missing user_id" }, { status: 400 });
    if (status !== "pending" && status !== "active" && status !== "blocked") {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    if (role !== "owner" && role !== "admin" && role !== "member") {
      return Response.json({ error: "Invalid role" }, { status: 400 });
    }

    // Prevent owner from blocking/demoting themselves
    if (user_id === ctx.userId) {
      if (status !== "active" || role !== "owner") {
        return Response.json({ error: "You cannot change your own access." }, { status: 400 });
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

    if (!target?.id) return Response.json({ error: "User not found" }, { status: 404 });

    // ✅ Seat safety: if this update would increase billable seats, enforce max_users
    const beforeBillable = isBillable(target.role, target.status);
    const afterBillable = isBillable(role, status);

    if (!beforeBillable && afterBillable) {
      const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
      const limits = getPlanLimits(plan);
const maxUsers = limits.max_users; // null => unlimited

      if (maxUsers != null) {
        const used = await countBillableSeats(db, ctx.agencyId);
        const pendingInvites = await countActivePendingInvites(db, ctx.agencyId);

        // Pending invites count toward seats (same rule as /api/agency/invites)
        if (used + pendingInvites >= maxUsers) {
          return Response.json(
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
    }

    await db.run(
      `UPDATE users
       SET status = ?, role = ?
       WHERE id = ? AND agency_id = ?`,
      status,
      role,
      user_id,
      ctx.agencyId
    );

    return Response.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return Response.json({ error: "Owner only" }, { status: 403 });
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
