// app/api/agency/users/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireOwnerOrAdmin } from "@/lib/authz";
import { ensureInviteTables } from "@/lib/db/ensure-invites";
import { nowIso } from "@/lib/tokens";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

type Ctx = {
  agencyId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  plan?: string | null;
};

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
  token?: string | null;
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

function isEmail(s: string) {
  const v = String(s ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function addDaysIso(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function randomToken() {
  // URL-safe token without padding
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function withTx<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.run("BEGIN");
  try {
    const out = await fn();
    await db.run("COMMIT");
    return out;
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    throw e;
  }
}

async function getSeatCounts(db: Db, agencyId: string) {
  const active = (await db.get(
    `SELECT COUNT(1) as n
     FROM users
     WHERE agency_id = ?
       AND status = 'active'
       AND role NOT IN ('owner','admin')`,
    agencyId
  )) as { n: number } | undefined;

  const pending = (await db.get(
    `SELECT COUNT(1) as n
     FROM users
     WHERE agency_id = ?
       AND status = 'pending'
       AND role NOT IN ('owner','admin')`,
    agencyId
  )) as { n: number } | undefined;

  const invites = (await db.get(
    `SELECT COUNT(1) as n
     FROM agency_invites
     WHERE agency_id = ?
       AND accepted_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > ?`,
    agencyId,
    nowIso()
  )) as { n: number } | undefined;

  const activeN = Number(active?.n ?? 0);
  const pendingN = Number(pending?.n ?? 0);
  const invitesN = Number(invites?.n ?? 0);

  return {
    activeBillableMembers: activeN,
    pendingBillableMembers: pendingN,
    pendingInvites: invitesN,
    reserved: pendingN + invitesN,
  };
}

async function getSeatState(db: Db, agencyId: string, maxUsers: number | null) {
  const users = (await db.all(
    `SELECT id, email, role, status, created_at
     FROM users
     WHERE agency_id = ?`,
    agencyId
  )) as UserRow[];

  const normalizedUsers = users.map((u) => ({
    id: u.id,
    email: u.email,
    role: normalizeRole(u.role),
    status: normalizeStatus(u.status),
    created_at: u.created_at,
  }));

  const activeBillableMembers = normalizedUsers.filter(
    (u) => u.status === "active" && u.role !== "owner" && u.role !== "admin"
  ).length;

  const pendingBillableMembers = normalizedUsers.filter(
    (u) => u.status === "pending" && u.role !== "owner" && u.role !== "admin"
  ).length;

  const invites = (await db.all(
    `SELECT id, email, token, created_at, expires_at
     FROM agency_invites
     WHERE agency_id = ?
       AND accepted_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > ?`,
    agencyId,
    nowIso()
  )) as InviteRow[];

  const pendingInvites = (invites ?? []).length;
  const reserved = pendingBillableMembers + pendingInvites;

  return {
    normalizedUsers,
    activeBillableMembers,
    pendingBillableMembers,
    pendingInvites,
    reserved,
    maxUsers,
    canCreateAnotherPipelineSeat: maxUsers == null ? true : activeBillableMembers + reserved < maxUsers,
    canActivateAnotherMember: maxUsers == null ? true : activeBillableMembers < maxUsers,
  };
}

function forbidden(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 403 });
}

function bad(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = (await requireOwnerOrAdmin(req)) as Ctx;

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureRoleStatusColumns(db);
    await ensureInviteTables();

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

    const seatState = await getSeatState(db, ctx.agencyId, maxUsers);

    // Pending invites (unaccepted, unrevoked, unexpired)
    const invites = (await db.all(
      `SELECT id, email, token, created_at, expires_at
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
      token: (i as any)?.token ?? null,
      created_at: i.created_at,
      expires_at: i.expires_at,
    }));

    return NextResponse.json({
      ok: true,
      plan,
      seats: {
        used: seatState.activeBillableMembers,
        pending_members: seatState.pendingBillableMembers,
        pending_invites: seatState.pendingInvites,
        reserved: seatState.reserved,
        limit: maxUsers,
      },
      users: seatState.normalizedUsers,
      invites: pendingInvites,
      enforcement: {
        can_create_invite: seatState.canCreateAnotherPipelineSeat,
        can_activate_member: seatState.canActivateAnotherMember,
      },
      can_manage: {
        view: true,
        edit_members: ctx.role === "owner" || ctx.role === "admin",
        transfer_ownership: ctx.role === "owner",
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
    if (msg === "FORBIDDEN_NOT_ADMIN_OR_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_OWNER" }, { status: 403 });
    }

    console.error("AGENCY_USERS_GET_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Create invite (owner/admin only). TX-safe seat pipeline enforcement.
  try {
    const ctx = (await requireOwnerOrAdmin(req)) as Ctx;

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureRoleStatusColumns(db);
    await ensureInviteTables();

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
    const maxUsers = pickMaxUsersFromLimits(limits);

    const body = (await req.json().catch(() => ({}))) as any;
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!isEmail(email)) return bad("INVALID_EMAIL");

    return await withTx(db, async () => {
      // Don’t invite existing users (any status) — checked inside TX
      const existing = (await db.get(
        `SELECT id FROM users WHERE agency_id = ? AND lower(email) = lower(?) LIMIT 1`,
        ctx.agencyId,
        email
      )) as { id: string } | undefined;

      if (existing?.id) return bad("USER_ALREADY_EXISTS");

      // Reuse existing active invite if present — checked inside TX
      const existingInvite = (await db.get(
        `SELECT id, token, email, created_at, expires_at
         FROM agency_invites
         WHERE agency_id = ?
           AND lower(email) = lower(?)
           AND accepted_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?
         LIMIT 1`,
        ctx.agencyId,
        email,
        nowIso()
      )) as InviteRow | undefined;

      const origin = req.nextUrl.origin;
      const joinPath = "/join";

      if (existingInvite?.id) {
        const token = (existingInvite as any)?.token ?? null;
        return NextResponse.json({
          ok: true,
          invite: {
            id: existingInvite.id,
            email,
            created_at: existingInvite.created_at,
            expires_at: existingInvite.expires_at,
          },
          link: token ? `${origin}${joinPath}?token=${encodeURIComponent(String(token))}` : null,
        });
      }

      // Enforce seats inside TX (race-safe)
      const counts = await getSeatCounts(db, ctx.agencyId);
      if (maxUsers != null && counts.activeBillableMembers + counts.reserved >= maxUsers) {
        return NextResponse.json(
          {
            ok: false,
            error: "SEAT_LIMIT_REACHED",
            seats: { used: counts.activeBillableMembers, reserved: counts.reserved, limit: maxUsers },
          },
          { status: 403 }
        );
      }

      const id = crypto.randomUUID();
      const token = randomToken();
      const expiresAt = addDaysIso(7);

      await db.run(
        `INSERT INTO agency_invites (id, agency_id, email, token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        ctx.agencyId,
        email,
        token,
        nowIso(),
        expiresAt
      );

      return NextResponse.json({
        ok: true,
        invite: { id, email, created_at: nowIso(), expires_at: expiresAt },
        link: `${origin}${joinPath}?token=${encodeURIComponent(token)}`,
      });
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_ADMIN_OR_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_OWNER" }, { status: 403 });
    }

    console.error("AGENCY_USERS_POST_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  // Update member (status/role). TX-safe seat enforcement on activation.
  try {
    const ctx = (await requireOwnerOrAdmin(req)) as Ctx;

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureRoleStatusColumns(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
    const maxUsers = pickMaxUsersFromLimits(limits);

    const body = (await req.json().catch(() => ({}))) as any;
    const userId = String(body?.userId ?? "").trim();
    if (!userId) return bad("MISSING_USER_ID");

    return await withTx(db, async () => {
      const row = (await db.get(
        `SELECT id, email, role, status
         FROM users
         WHERE agency_id = ? AND id = ?
         LIMIT 1`,
        ctx.agencyId,
        userId
      )) as UserRow | undefined;

      if (!row?.id) return bad("USER_NOT_FOUND");

      const currentRole = normalizeRole(row.role);
      const currentStatus = normalizeStatus(row.status);

      // Permission guards
      if (row.id === ctx.userId) return forbidden("CANNOT_EDIT_SELF");
      if (currentRole === "owner") return forbidden("CANNOT_EDIT_OWNER");

      const nextRole = body?.role != null ? normalizeRole(body.role) : currentRole;
      const nextStatus = body?.status != null ? normalizeStatus(body.status) : currentStatus;

      // Only owner can edit admins
      if (currentRole === "admin" && ctx.role !== "owner") return forbidden("ONLY_OWNER_CAN_EDIT_ADMINS");

      // No ownership transfer here (separate flow)
      if (body?.role != null && String(body.role ?? "").toLowerCase() === "owner") {
        return forbidden("OWNERSHIP_TRANSFER_NOT_SUPPORTED_HERE");
      }

      // Enforce seats only when activating a billable member, inside TX (race-safe)
      const becomingActive = currentStatus !== "active" && nextStatus === "active";
      const billableMember = nextRole !== "owner" && nextRole !== "admin";

      if (becomingActive && billableMember) {
        const counts = await getSeatCounts(db, ctx.agencyId);
        if (maxUsers != null && counts.activeBillableMembers >= maxUsers) {
          return NextResponse.json(
            { ok: false, error: "SEAT_LIMIT_REACHED", seats: { used: counts.activeBillableMembers, limit: maxUsers } },
            { status: 403 }
          );
        }
      }

      await db.run(
        `UPDATE users
         SET role = ?, status = ?
         WHERE agency_id = ? AND id = ?`,
        nextRole,
        nextStatus,
        ctx.agencyId,
        row.id
      );

      return NextResponse.json({
        ok: true,
        user: { id: row.id, email: row.email, role: nextRole, status: nextStatus },
      });
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_ADMIN_OR_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_OWNER" }, { status: 403 });
    }

    console.error("AGENCY_USERS_PATCH_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  // Remove user OR revoke invite. Owner/admin only.
  try {
    const ctx = (await requireOwnerOrAdmin(req)) as Ctx;

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureRoleStatusColumns(db);
    await ensureInviteTables();

    const url = new URL(req.url);
    const userId = String(url.searchParams.get("userId") ?? "").trim();
    const inviteId = String(url.searchParams.get("inviteId") ?? "").trim();

    const body = (await req.json().catch(() => ({}))) as any;
    const bodyUserId = String(body?.userId ?? "").trim();
    const bodyInviteId = String(body?.inviteId ?? "").trim();

    const targetUserId = userId || bodyUserId;
    const targetInviteId = inviteId || bodyInviteId;

    if (!targetUserId && !targetInviteId) return bad("MISSING_TARGET");

    if (targetInviteId) {
      await db.run(
        `UPDATE agency_invites
         SET revoked_at = ?
         WHERE agency_id = ? AND id = ? AND accepted_at IS NULL`,
        nowIso(),
        ctx.agencyId,
        targetInviteId
      );
      return NextResponse.json({ ok: true });
    }

    if (targetUserId === ctx.userId) return forbidden("CANNOT_DELETE_SELF");

    const row = (await db.get(
      `SELECT id, role
       FROM users
       WHERE agency_id = ? AND id = ?
       LIMIT 1`,
      ctx.agencyId,
      targetUserId
    )) as { id: string; role: string | null } | undefined;

    if (!row?.id) return bad("USER_NOT_FOUND");

    const targetRole = normalizeRole(row.role);
    if (targetRole === "owner") return forbidden("CANNOT_DELETE_OWNER");
    if (targetRole === "admin" && ctx.role !== "owner") return forbidden("ONLY_OWNER_CAN_DELETE_ADMINS");

    await db.run(`DELETE FROM users WHERE agency_id = ? AND id = ?`, ctx.agencyId, row.id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_ADMIN_OR_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_OWNER" }, { status: 403 });
    }

    console.error("AGENCY_USERS_DELETE_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: msg }, { status: 500 });
  }
}