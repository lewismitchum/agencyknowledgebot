// app/api/notifications/read/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { normalizePlan, hasFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
}

export async function POST(req: NextRequest) {
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
    if (!scheduleEnabled) {
      return NextResponse.json(
        { ok: false, error: "UPGRADE_REQUIRED", message: "Upgrade to unlock notifications." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as { id?: string } | null;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    // Only mark within agency, and only for this user or global notifications
    const now = new Date().toISOString();
    const res = await db.run(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, ?)
       WHERE id = ?
         AND agency_id = ?
         AND (user_id IS NULL OR user_id = ?)`,
      now,
      id,
      ctx.agencyId,
      ctx.userId
    );

    return NextResponse.json({ ok: true, updated: (res as any)?.changes ?? 0 });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    console.error("NOTIFICATIONS_READ_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}