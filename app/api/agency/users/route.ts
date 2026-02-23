import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireOwnerOrAdmin } from "@/lib/authz";
import { ensureInviteTables } from "@/lib/db/ensure-invites";
import { nowIso } from "@/lib/tokens";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return "pending";
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

export async function GET(req: NextRequest) {
  try {
    // ✅ owner OR admin can view members (UI requires it)
    const ctx = await requireOwnerOrAdmin(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureRoleStatusColumns(db);
    await ensureInviteTables();

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
    const maxUsers = pickMaxUsersFromLimits(limits);

    const users = (await db.all(
      `SELECT id, email, role, status, created_at
       FROM users
       WHERE agency_id = ?
       ORDER BY created_at DESC`,
      ctx.agencyId
    )) as UserRow[];

    // self-heal legacy rows
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

    const billableUsed = normalizedUsers.filter(
      (u) => u.status !== "blocked" && u.role !== "owner" && u.role !== "admin"
    ).length;

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
        limit: maxUsers,
      },
      users: normalizedUsers,
      invites: pendingInvites,
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (code === "FORBIDDEN_NOT_ADMIN_OR_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
    }

    console.error("AGENCY_USERS_GET_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: code }, { status: 500 });
  }
}