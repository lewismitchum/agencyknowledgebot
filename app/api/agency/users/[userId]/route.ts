// app/api/agency/users/[userId]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";

export const runtime = "nodejs";

type UserRow = {
  id: string;
  email: string;
  role: string | null;
  status: string | null;
};

type RouteCtx = {
  params: Promise<{ userId: string }>;
};

async function ensureRoleStatusColumns(db: Db) {
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  // updated_at might not exist in your schema everywhere; best-effort.
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
}

function normalizeRole(raw: unknown): "owner" | "member" {
  return String(raw ?? "").toLowerCase() === "owner" ? "owner" : "member";
}

function normalizeStatus(raw: unknown): "active" | "pending" | "blocked" {
  const v = String(raw ?? "").toLowerCase();
  if (v === "active") return "active";
  if (v === "blocked") return "blocked";
  return "pending";
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Back-compat endpoint for your existing UI:
 * POST { action: "approve" | "deny" }
 * - approve -> status=active
 * - deny -> status=blocked
 */
export async function POST(req: NextRequest, ctx2: RouteCtx) {
  try {
    const ctx = await requireOwner(req);
    const { userId } = await ctx2.params;
    const targetUserId = String(userId || "");

    const body = (await req.json().catch(() => ({}))) as any;
    const action = String(body?.action || "");

    if (action !== "approve" && action !== "deny") {
      return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    }

    // Prevent self lockout
    if (targetUserId === ctx.userId) {
      return NextResponse.json({ ok: false, error: "CANNOT_MODIFY_SELF" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureRoleStatusColumns(db);

    const user = (await db.get(
      `SELECT id, email, role, status
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      targetUserId,
      ctx.agencyId
    )) as UserRow | undefined;

    if (!user?.id) {
      return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // Backfill missing role/status first so logic is consistent
    const role = normalizeRole(user.role);
    const status = normalizeStatus(user.status);

    const needsRole = user.role == null || user.role === "";
    const needsStatus = user.status == null || user.status === "";
    if (needsRole || needsStatus) {
      await db.run(
        `UPDATE users
         SET role = COALESCE(NULLIF(role, ''), ?),
             status = COALESCE(NULLIF(status, ''), ?)
         WHERE id = ? AND agency_id = ?`,
        role,
        status,
        targetUserId,
        ctx.agencyId
      );
    }

    // You can modify an owner user, but only their status? No.
    // Safer: do not allow modifying other owners.
    if (role === "owner") {
      return NextResponse.json({ ok: false, error: "CANNOT_MODIFY_OWNER" }, { status: 400 });
    }

    const nextStatus: "active" | "blocked" = action === "approve" ? "active" : "blocked";

    await db.run(
      `UPDATE users
       SET status = ?, updated_at = ?
       WHERE id = ? AND agency_id = ?`,
      nextStatus,
      nowIso(),
      targetUserId,
      ctx.agencyId
    );

    return NextResponse.json({ ok: true, userId: targetUserId, status: nextStatus });
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

/**
 * Clean future endpoint (optional for UI later):
 * PATCH { status?: "active"|"pending"|"blocked", role?: "owner"|"member" }
 */
export async function PATCH(req: NextRequest, ctx2: RouteCtx) {
  try {
    const ctx = await requireOwner(req);
    const { userId } = await ctx2.params;
    const targetUserId = String(userId || "");

    const body = (await req.json().catch(() => ({}))) as {
      role?: "owner" | "member";
      status?: "active" | "pending" | "blocked";
    };

    const wantsRole = body.role !== undefined;
    const wantsStatus = body.status !== undefined;

    if (!wantsRole && !wantsStatus) {
      return NextResponse.json({ ok: false, error: "NO_UPDATES" }, { status: 400 });
    }
    if (wantsRole && body.role !== "owner" && body.role !== "member") {
      return NextResponse.json({ ok: false, error: "INVALID_ROLE" }, { status: 400 });
    }
    if (
      wantsStatus &&
      body.status !== "active" &&
      body.status !== "pending" &&
      body.status !== "blocked"
    ) {
      return NextResponse.json({ ok: false, error: "INVALID_STATUS" }, { status: 400 });
    }

    // Prevent self lockout / self-demotion footguns
    if (targetUserId === ctx.userId) {
      if (wantsStatus && body.status !== "active") {
        return NextResponse.json({ ok: false, error: "CANNOT_CHANGE_OWN_STATUS" }, { status: 400 });
      }
      if (wantsRole && body.role !== "owner") {
        return NextResponse.json({ ok: false, error: "CANNOT_DEMOTE_SELF" }, { status: 400 });
      }
    }

    const db: Db = await getDb();
    await ensureRoleStatusColumns(db);

    const existing = (await db.get(
      `SELECT id, email, role, status
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      targetUserId,
      ctx.agencyId
    )) as UserRow | undefined;

    if (!existing?.id) {
      return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // Do not allow modifying other owners (safe default)
    if (normalizeRole(existing.role) === "owner" && targetUserId !== ctx.userId) {
      return NextResponse.json({ ok: false, error: "CANNOT_MODIFY_OWNER" }, { status: 400 });
    }

    const nextRole = wantsRole ? body.role! : normalizeRole(existing.role);
    const nextStatus = wantsStatus ? body.status! : normalizeStatus(existing.status);

    await db.run(
      `UPDATE users
       SET role = ?, status = ?, updated_at = ?
       WHERE id = ? AND agency_id = ?`,
      nextRole,
      nextStatus,
      nowIso(),
      targetUserId,
      ctx.agencyId
    );

    return NextResponse.json({
      ok: true,
      user: {
        id: targetUserId,
        email: existing.email,
        role: nextRole,
        status: nextStatus,
      },
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
