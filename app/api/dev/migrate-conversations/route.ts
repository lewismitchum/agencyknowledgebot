import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Minimal helper to extract a session object from the request.
 * Supports a JSON-encoded session in the "x-session" header or a "session" cookie.
 * Returns null on failure.
 */
function getSessionFromRequest(req: NextRequest): any {
  try {
    const header = req.headers.get("x-session");
    if (header) return JSON.parse(header);
    const cookie = req.headers.get("cookie");
    if (!cookie) return null;
    const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
    if (match) {
      try {
        return JSON.parse(decodeURIComponent(match[1]));
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
    const exec = db?.run ?? db?.execute ?? db?.exec ?? db?.query ?? db?.client?.execute;

    if (typeof exec !== "function") {
      return Response.json(
        { error: "DB has no write method", dbKeys: Object.keys(db ?? {}) },
        { status: 500 }
      );
    }

    const results: any[] = [];

    // conversations table
    try {
      await exec.call(
        db,
        `CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          summary TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, bot_id)
        );`
      );
      results.push({ step: "create_conversations_table", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE TABLE failed", step: "create_conversations_table", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    try {
      await exec.call(
        db,
        "CREATE INDEX IF NOT EXISTS idx_conversations_user_bot ON conversations(user_id, bot_id);"
      );
      results.push({ step: "index_conversations_user_bot", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE INDEX failed", step: "index_conversations_user_bot", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, results });
  } catch (err: any) {
    console.error("DEV_MIGRATE_CONVERSATIONS_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
