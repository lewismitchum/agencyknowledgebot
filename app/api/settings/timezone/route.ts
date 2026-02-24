// app/api/settings/timezone/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function isValidIanaTimezone(tz: string) {
  const t = String(tz || "").trim();
  if (!t) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const row = (await db.get(`SELECT timezone FROM agencies WHERE id = ? LIMIT 1`, ctx.agencyId)) as
      | { timezone?: string | null }
      | undefined;

    const tz = String(row?.timezone ?? "").trim() || "America/Chicago";

    return Response.json({ ok: true, timezone: tz });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("TZ_GET_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as { timezone?: string } | null;
    const tz = String(body?.timezone ?? "").trim();

    if (!isValidIanaTimezone(tz)) {
      return Response.json({ ok: false, error: "INVALID_TIMEZONE" }, { status: 400 });
    }

    await db.run(`UPDATE agencies SET timezone = ? WHERE id = ?`, tz, ctx.agencyId);

    return Response.json({ ok: true, timezone: tz });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("TZ_POST_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}