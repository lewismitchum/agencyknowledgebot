import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getOrCreateUser } from "@/lib/users";

export const runtime = "nodejs";

/**
 * Development-only session extractor: reads agency info from request headers
 * 'x-agency-id' and 'x-agency-email' or from cookies 'agencyId' and 'agencyEmail'.
 */
async function getSession(req: NextRequest) {
  const agencyId =
    req.headers.get("x-agency-id") ||
    req.cookies.get("agencyId")?.value ||
    null;
  const agencyEmail =
    req.headers.get("x-agency-email") ||
    req.cookies.get("agencyEmail")?.value ||
    null;

  if (!agencyId) return null;
  return { agencyId, agencyEmail };
}

export async function GET(req: NextRequest) {
  try {
    if (process.env.NODE_ENV !== "development") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const session = await getSession(req);
    if (!session?.agencyId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db: any = await getDb();
    const user = await getOrCreateUser(session.agencyId, session.agencyEmail);

    const rows = await db.all(
      `SELECT id, user_id, bot_id, summary, message_count, created_at, updated_at
       FROM conversations
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
      user.id
    );

    return Response.json({ ok: true, user_id: user.id, conversations: rows ?? [] });
  } catch (err: any) {
    console.error("DEV_CONVERSATION_LIST_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
