// app/api/dev/conversations/route.ts
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { getOrCreateUser } from "@/lib/users";

export const runtime = "nodejs";

/**
 * Dev-only: list conversations for the current agency + current user.
 * Useful for debugging summarization + message_count behavior.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: any = await getDb();

    // ensure user exists for this agency/email
    const user = await getOrCreateUser(ctx.agencyId, ctx.agencyEmail);

    const rows = await db.all(
      `SELECT id, agency_id, bot_id, owner_user_id, title, summary, message_count, created_at, updated_at
       FROM conversations
       WHERE agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       ORDER BY updated_at DESC
       LIMIT 200`,
      ctx.agencyId,
      user.id
    );

    return Response.json({ ok: true, conversations: rows ?? [] });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
