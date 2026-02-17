import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

import { getOrCreateUser } from "@/lib/users";
import { getOrCreateConversation, setConversationSummary } from "@/lib/conversations";
import { summarizeConversation } from "@/lib/summarizeConversation";

export const runtime = "nodejs";

type Body = {
  bot_id?: string;
  transcript?: string;
};

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV !== "development") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const session = getSessionFromRequest(req);
    if (!session?.agencyId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    const botId = String(body?.bot_id ?? "").trim();
    const transcript = String(body?.transcript ?? "").trim();

    if (!botId) return Response.json({ error: "Missing bot_id" }, { status: 400 });
    if (!transcript) return Response.json({ error: "Missing transcript" }, { status: 400 });

    const user = await getOrCreateUser(session.agencyId, session.agencyEmail);

    // Ensure conversation exists
    const convo = await getOrCreateConversation(user.id, botId);

    // Summarize and store
    const summary = await summarizeConversation(transcript);
if (summary) {
  await setConversationSummary(convo.id, summary);
}

    // Return updated row
    const db: any = await getDb();
    const updated = await db.get(
      `SELECT id, user_id, bot_id, summary, message_count, created_at, updated_at
       FROM conversations
       WHERE id = ?
       LIMIT 1`,
      convo.id
    );

    return Response.json({ ok: true, bot_id: botId, summary, conversation: updated ?? null });
  } catch (err: any) {
    console.error("DEV_FORCE_SUMMARIZE_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
