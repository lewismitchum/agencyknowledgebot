// app/api/dev/backfill-docs-bot-id/route.ts
import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
/* session will be dynamically imported inside the POST handler to avoid typing mismatches */

export const runtime = "nodejs";

/**
 * Dev utility:
 * Backfills documents.bot_id for rows that were created before bot scoping existed.
 * Safe-ish: only updates rows where bot_id is NULL/empty.
 */
export async function POST(req: NextRequest) {
  try {
    const sessionLib = (await import("@/lib/session")) as any;
    const session = await (sessionLib.getSession?.(req) ?? (sessionLib.default ? sessionLib.default(req) : null));
    if (!session?.agencyId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db: Db = await getDb();

    // Pick an agency bot as the fallback (prefer shared agency bot)
    const bot = (await db.get(
      `SELECT id
       FROM bots
       WHERE agency_id = ?
       ORDER BY CASE WHEN owner_user_id IS NULL THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      session.agencyId
    )) as { id: string } | undefined;

    if (!bot?.id) {
      return Response.json({ error: "No bots found for agency" }, { status: 404 });
    }

    // Update only docs missing bot_id
    await db.run(
      `UPDATE documents
       SET bot_id = ?
       WHERE agency_id = ?
         AND (bot_id IS NULL OR bot_id = '')`,
      bot.id,
      session.agencyId
    );

    // Return count for visibility
    const row = (await db.get(
      `SELECT COUNT(*) as c
       FROM documents
       WHERE agency_id = ?
         AND (bot_id IS NULL OR bot_id = '')`,
      session.agencyId
    )) as { c: number } | undefined;

    return Response.json({ ok: true, fallback_bot_id: bot.id, remaining_missing: Number(row?.c ?? 0) });
  } catch (err: any) {
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
