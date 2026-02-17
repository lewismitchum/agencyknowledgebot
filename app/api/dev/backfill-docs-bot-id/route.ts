import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";


export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV !== "development") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const session = getSessionFromRequest(req);
    if (!session?.agencyId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db: any = await getDb();

    const exec =
      db?.run ?? db?.execute ?? db?.exec ?? db?.query ?? db?.client?.execute;

    if (typeof exec !== "function") {
      return Response.json(
        { error: "DB has no write method", dbKeys: Object.keys(db ?? {}) },
        { status: 500 }
      );
    }

    // default agency bot
    const bot: any = await db.get(
      `SELECT id FROM bots
       WHERE agency_id = ? AND owner_user_id IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      session.agencyId
    );

    if (!bot?.id) {
      return Response.json({ error: "No default bot found" }, { status: 500 });
    }

    // Backfill bot_id on docs where NULL/empty
    // Try both common signatures: (sql, ...args) and ({ sql, args })
    const sql = `UPDATE documents
                 SET bot_id = ?
                 WHERE agency_id = ? AND (bot_id IS NULL OR bot_id = '')`;
    const args = [bot.id, session.agencyId];

    try {
      await exec.call(db, sql, ...args);
    } catch (e1: any) {
      try {
        await exec.call(db, { sql, args });
      } catch (e2: any) {
        return Response.json(
          {
            error: "DB update failed",
            e1: String(e1?.message ?? e1),
            e2: String(e2?.message ?? e2),
          },
          { status: 500 }
        );
      }
    }

    return Response.json({ ok: true, bot_id: bot.id });
  } catch (err: any) {
    console.error("BACKFILL_DOCS_BOT_ID_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
