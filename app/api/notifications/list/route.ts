// app/api/notifications/list/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, hasFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Upsell = { code?: string; message?: string };

async function ensureNotificationsTables(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT,
      title TEXT,
      body TEXT,
      url TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
  `);

  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_agency_created ON notifications (agency_id, created_at DESC);`);
  } catch {}

  try {
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (agency_id, user_id, created_at DESC);`);
  } catch {}
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureNotificationsTables(db);

    const agency = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, ctx.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const plan = normalizePlan(agency?.plan ?? (ctx as any)?.plan ?? "free");
    const scheduleEnabled = hasFeature(plan, "schedule");

    const upsell: Upsell | null = scheduleEnabled
      ? null
      : {
          code: "UPSELL_SCHEDULE",
          message: "Upgrade to unlock notifications (schedule + tasks extracted from docs).",
        };

    if (!scheduleEnabled) {
      return NextResponse.json({
        ok: true,
        plan,
        upsell,
        notifications: [],
      });
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    // For now: agency-wide notifications (user_id NULL) + user-specific (if present)
    const rows = (await db.all(
      `SELECT id, type, title, body, url, created_at, read_at
       FROM notifications
       WHERE agency_id = ?
         AND (user_id IS NULL OR user_id = ?)
       ORDER BY created_at DESC
       LIMIT ?`,
      ctx.agencyId,
      ctx.userId,
      limit
    )) as Array<{
      id: string;
      type: string | null;
      title: string | null;
      body: string | null;
      url: string | null;
      created_at: string;
      read_at: string | null;
    }>;

    return NextResponse.json({
      ok: true,
      plan,
      upsell,
      notifications: (rows ?? []).map((r) => ({
        id: String(r.id),
        type: r.type ? String(r.type) : null,
        title: r.title ? String(r.title) : null,
        body: r.body ? String(r.body) : null,
        url: r.url ? String(r.url) : null,
        created_at: String(r.created_at),
        read_at: r.read_at ? String(r.read_at) : null,
      })),
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    console.error("NOTIFICATIONS_LIST_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}