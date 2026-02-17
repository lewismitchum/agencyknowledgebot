// app/api/me/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { normalizeUserRole, normalizeUserStatus } from "@/lib/users";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function chicagoMidnightResetInSeconds(now = new Date()) {
  const tz = "America/Chicago";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value;

  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));

  const todayUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const tomorrowUtc = new Date(todayUtc.getTime() + 24 * 3600 * 1000);

  return Math.max(0, Math.floor((tomorrowUtc.getTime() - now.getTime()) / 1000));
}

// Canonical daily key (UTC). Keep consistent across chat + uploads.
function todayYmdUtc() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getDailyUsage(db: Db, agencyId: string, date: string) {
  const row = (await db.get(
    `SELECT messages_count, uploads_count
     FROM usage_daily
     WHERE agency_id = ? AND date = ?
     LIMIT 1`,
    agencyId,
    date
  )) as { messages_count: number; uploads_count: number } | undefined;

  return {
    messages_count: Number(row?.messages_count ?? 0),
    uploads_count: Number(row?.uploads_count ?? 0),
  };
}

export async function GET(req: NextRequest) {
  try {
    // ✅ Ensure schema exists before any reads (fixes "no such column: messages_count")
    await ensureSchema().catch(() => {});

    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();

    const agency = (await db.get(
      "SELECT id, email, email_verified, plan FROM agencies WHERE id = ? LIMIT 1",
      ctx.agencyId
    )) as
      | { id: string; email: string; email_verified: number; plan: string | null }
      | undefined;

    if (!agency?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const plan = normalizePlan(agency.plan ?? ctx.plan);
    const limits = getPlanLimits(plan);

    const docsRow = (await db.get(
      "SELECT COUNT(*) as c FROM documents WHERE agency_id = ?",
      agency.id
    )) as { c: number } | undefined;

    const documents_count = Number(docsRow?.c ?? 0);

    const date = todayYmdUtc();
    const usage = await getDailyUsage(db, agency.id, date);

    const daily_used = usage.messages_count;

    // NOTE: if your plan model uses null/undefined for unlimited, keep the existing behavior:
    // this matches your old code (defaults to 0 if missing).
    const daily_limit = Number((limits as any).daily_messages ?? (limits as any).dailyMessages ?? 0);
    const daily_remaining = Math.max(0, daily_limit - daily_used);

    const uploads_used = usage.uploads_count;
    const uploads_limit = (limits as any).daily_uploads ?? (limits as any).dailyUploads ?? null; // null => unlimited
    const uploads_remaining = uploads_limit == null ? null : Math.max(0, uploads_limit - uploads_used);

    // Pull role/status from DB (ctx already backfilled + normalized)
    const userRow = (await db.get(
      `SELECT id, email, email_verified, role, status
       FROM users
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      ctx.userId,
      ctx.agencyId
    )) as
      | { id: string; email: string; email_verified: number; role: string | null; status: string | null }
      | undefined;

    return NextResponse.json({
      plan,
      documents_count,

      daily_remaining,
      daily_used,
      daily_limit,

      uploads_used,
      uploads_limit,
      uploads_remaining,

      daily_resets_in_seconds: chicagoMidnightResetInSeconds(),

      user: {
        id: userRow?.id ?? ctx.userId,
        email: userRow?.email ?? ctx.agencyEmail,
        email_verified: Boolean(userRow?.email_verified ?? 0),
        role: normalizeUserRole(userRow?.role ?? (ctx as any).role),
        status: normalizeUserStatus(userRow?.status ?? (ctx as any).status),
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    console.error("ME_ROUTE_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}

// Safety stub: keeps the route module shape unambiguous in typed-route builds
export async function POST(req: NextRequest) {
  try {
    await requireActiveMember(req);
    return NextResponse.json({ error: "METHOD_NOT_ALLOWED", hint: "Use GET /api/me" }, { status: 405 });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}
