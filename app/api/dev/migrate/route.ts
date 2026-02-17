import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";


export const runtime = "nodejs";

function getSessionFromRequest(req: NextRequest): { agencyId?: string } | undefined {
  // For development migrations, allow passing the agency id via the `x-agency-id` header.
  // Return undefined if no session info is present.
  const agencyId = req.headers.get("x-agency-id") ?? undefined;
  if (!agencyId) return undefined;
  return { agencyId };
}

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

    const results: any[] = [];

    // ----------------------------
    // 1) documents.bot_id column
    // ----------------------------
    try {
      await exec.call(db, "ALTER TABLE documents ADD COLUMN bot_id TEXT;");
      results.push({ step: "add_documents_bot_id", ok: true, ran: true });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("duplicate column")) {
        results.push({ step: "add_documents_bot_id", ok: true, ran: false });
      } else {
        return Response.json(
          { error: "ALTER TABLE failed", step: "add_documents_bot_id", message: msg },
          { status: 500 }
        );
      }
    }

    try {
      await exec.call(
        db,
        "CREATE INDEX IF NOT EXISTS idx_documents_agency_bot ON documents(agency_id, bot_id);"
      );
      results.push({ step: "index_documents_agency_bot", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE INDEX failed", step: "index_documents_agency_bot", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    // ----------------------------
    // 2) users table
    // ----------------------------
    try {
      await exec.call(
        db,
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          agency_id TEXT NOT NULL,
          email TEXT NOT NULL,
          email_verified INTEGER NOT NULL DEFAULT 0,
          password_hash TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(agency_id, email)
        );`
      );
      results.push({ step: "create_users_table", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE TABLE failed", step: "create_users_table", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    try {
      await exec.call(
        db,
        "CREATE INDEX IF NOT EXISTS idx_users_agency_email ON users(agency_id, email);"
      );
      results.push({ step: "index_users_agency_email", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE INDEX failed", step: "index_users_agency_email", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    // ----------------------------
    // 3) Backfill: create a user for this agency if missing
    // ----------------------------
    const agency: any = await db.get(
      "SELECT id, email, email_verified FROM agencies WHERE id = ? LIMIT 1",
      session.agencyId
    );

    if (!agency?.id || !agency?.email) {
      return Response.json(
        { error: "Agency not found for session", agencyId: session.agencyId },
        { status: 500 }
      );
    }

    const email = String(agency.email).toLowerCase();

    const existing: any = await db.get(
      "SELECT id FROM users WHERE agency_id = ? AND lower(email) = ? LIMIT 1",
      agency.id,
      email
    );

    if (existing?.id) {
      results.push({
        step: "backfill_user_for_agency",
        ok: true,
        created: false,
        user_id: existing.id,
      });
    } else {
      const userId =
        (globalThis.crypto &&
          "randomUUID" in globalThis.crypto &&
          (globalThis.crypto as any).randomUUID())
          ? (globalThis.crypto as any).randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      await exec.call(
        db,
        "INSERT INTO users (id, agency_id, email, email_verified) VALUES (?, ?, ?, ?)",
        userId,
        agency.id,
        email,
        Number(agency.email_verified ?? 0)
      );

      results.push({
        step: "backfill_user_for_agency",
        ok: true,
        created: true,
        user_id: userId,
      });
    }

    // ----------------------------
    // 4) extractions table (events/tasks derived from docs)
    // ----------------------------
    try {
      await exec.call(
        db,
        `CREATE TABLE IF NOT EXISTS extractions (
          id TEXT PRIMARY KEY,
          agency_id TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          user_id TEXT, -- nullable for agency-wide extracted items later

          type TEXT NOT NULL, -- 'event' | 'task'
          title TEXT NOT NULL,

          start_at TEXT, -- ISO string (events)
          end_at TEXT,   -- ISO string (events)

          due_at TEXT,   -- ISO string (tasks)

          confidence REAL NOT NULL DEFAULT 0.0,
          source_excerpt TEXT, -- small snippet from doc

          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );`
      );
      results.push({ step: "create_extractions_table", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE TABLE failed", step: "create_extractions_table", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    // Helpful indexes
    try {
      await exec.call(
        db,
        "CREATE INDEX IF NOT EXISTS idx_extractions_agency_bot ON extractions(agency_id, bot_id);"
      );
      results.push({ step: "index_extractions_agency_bot", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE INDEX failed", step: "index_extractions_agency_bot", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    try {
      await exec.call(
        db,
        "CREATE INDEX IF NOT EXISTS idx_extractions_agency_user ON extractions(agency_id, user_id);"
      );
      results.push({ step: "index_extractions_agency_user", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE INDEX failed", step: "index_extractions_agency_user", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    try {
      await exec.call(
        db,
        "CREATE INDEX IF NOT EXISTS idx_extractions_document ON extractions(document_id);"
      );
      results.push({ step: "index_extractions_document", ok: true });
    } catch (e: any) {
      return Response.json(
        { error: "CREATE INDEX failed", step: "index_extractions_document", message: String(e?.message ?? e) },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, results });
  } catch (err: any) {
    console.error("DEV_MIGRATE_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
