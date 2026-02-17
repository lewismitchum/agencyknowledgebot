import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

import { getOrCreateUser } from "@/lib/users";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session?.agencyId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db: any = await getDb();
    const user = await getOrCreateUser(session.agencyId, session.agencyEmail);

    // Return if already exists
    const existing = (await db.get(
      `SELECT id, agency_id, owner_user_id, name, description, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      session.agencyId,
      user.id
    )) as any;

    if (existing?.id) {
      return Response.json({ ok: true, created: false, bot: existing });
    }

    const name = "My Private Bot";
    const description = "Private knowledge bot (user-scoped)";

    await db.run(
      `INSERT INTO bots (id, agency_id, owner_user_id, name, description, vector_store_id)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, NULL)`,
      session.agencyId,
      user.id,
      name,
      description
    );

    const created = (await db.get(
      `SELECT id, agency_id, owner_user_id, name, description, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      session.agencyId,
      user.id
    )) as any;

    return Response.json({ ok: true, created: true, bot: created ?? null });
  } catch (err: any) {
    console.error("CREATE_PRIVATE_BOT_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
