// app/api/members/update/route.ts
import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";

type Body = {
  user_id?: string;
  status?: "pending" | "active" | "blocked";
  role?: "owner" | "member" | "admin";
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
  // Billable seats exclude owner/admin, and exclude blocked users.
  const row = (await db.get(
    `SELECT COUNT(*) as c
     FROM users
     WHERE agency_id = ?
       AND COALESCE(status, 'pending') != 'blocked'
       AND COALESCE(role, 'member') NOT IN ('owner', 'admin')`,
    agencyId
  )) as { c: number } | undefined;

  return Number(row?.c ?? 0);
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
    if (role !== "owner" && role !== "member" && role !== "admin") {
      return Response.json({ error: "Invalid role" }, { status: 400 });
    }

    // Prevent owner from blocking/demoting themselves
    if (user_id === ctx.userId) {
      if (status !== "active" || role !== "owner") {
        return Response.json({ error: "You cannot change your own access." }, { status: 400 });
      }
    }

    const target = (await db.get(
      `SELECT id, role, status
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      user_id,
      ctx.agencyId
    )) as { id: string; role: string | null; status: string | null } | undefined;

    if (!target?.id) return Response.json({ error: "User not found" }, { status: 404 });

    // ✅ Seat limit enforcement ONLY when approving a billable seat
    // If:
    // - status is being set to active
    // - role is billable (member)
    // - user is not currently active member
    // then check plan cap.
    const targetPrevStatus = String(target.status ?? "pending").toLowerCase();
    const targetPrevRole = String(target.role ?? "member").toLowerCase();

    const becomingActive = status === "active" && targetPrevStatus !== "active";
    const billableRole = role === "member"; // owner/admin excluded by your seat policy
    const wasBillable = targetPrevRole !== "owner" && targetPrevRole !== "admin";

    if (becomingActive && billableRole) {
      const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan ?? null);
      const limits = getPlanLimits(plan);
      const maxUsers = pickMaxUsersFromLimits(limits);

      if (maxUsers != null) {
        const used = await countBillableSeats(db, ctx.agencyId);

        // If the user was already a billable seat (e.g., pending member), approving them does NOT increase seats.
        // BUT your billing definition counts pending as a seat too (because they are "not blocked").
        // So approval shouldn't change seat count; the cap is enforced on invites and now on approval.
        // Still, enforce here: if we're already at/over cap, don't allow new activations.
        if (used >= maxUsers) {
          return Response.json(
            {
              ok: false,
              error: "SEAT_LIMIT_EXCEEDED",
              plan,
              used,
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
