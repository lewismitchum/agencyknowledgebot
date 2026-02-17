import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";

import { getOrCreateUser } from "@/lib/users";

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
    const user = await getOrCreateUser(session.agencyId, session.agencyEmail);

    // Grab any doc we can see (most recent)
    const doc = (await db.get(
      `SELECT id, bot_id, filename
       FROM documents
       WHERE agency_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      session.agencyId
    )) as { id: string; bot_id: string | null; filename: string } | null;

    if (!doc?.id || !doc.bot_id) {
      return Response.json({ error: "No documents with bot_id found" }, { status: 400 });
    }

    // Insert a fake extraction row (safe, dev-only)
    const title = `Seeded task from ${doc.filename}`;
    await db.run(
      `INSERT INTO extractions (
        id, agency_id, bot_id, document_id, user_id,
        type, title, start_at, end_at, due_at, confidence, source_excerpt
      ) VALUES (
        lower(hex(randomblob(16))), ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )`,
      session.agencyId,
      doc.bot_id,
      doc.id,
      user.id,
      "task",
      title,
      null,
      null,
      new Date().toISOString(),
      0.5,
      "Seeded extraction (dev-only)."
    );

    return Response.json({ ok: true, seeded: true, document_id: doc.id, bot_id: doc.bot_id });
  } catch (err: any) {
    console.error("DEV_SEED_EXTRACTION_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
