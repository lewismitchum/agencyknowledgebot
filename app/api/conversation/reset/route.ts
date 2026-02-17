import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureChatTables } from "@/lib/ensureChatTables";

export const runtime = "nodejs";

type Body = {
  bot_id?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto &&
    "randomUUID" in globalThis.crypto &&
    (globalThis.crypto as any).randomUUID
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function assertBotAccess(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, agency_id, owner_user_id
     FROM bots
     WHERE id = ?
     LIMIT 1`,
    args.bot_id
  )) as { id: string; agency_id: string; owner_user_id: string | null } | undefined;

  if (!bot?.id) throw new Error("BOT_NOT_FOUND");
  if (bot.agency_id !== args.agency_id) throw new Error("FORBIDDEN_BOT");
  if (bot.owner_user_id && bot.owner_user_id !== args.user_id) throw new Error("FORBIDDEN_BOT");
}

async function getOrCreateConversationId(db: Db, args: { agencyId: string; userId: string; botId: string }) {
  const existing = (await db.get(
    `SELECT id
     FROM conversations
     WHERE agency_id = ? AND user_id = ? AND bot_id = ?
     LIMIT 1`,
    args.agencyId,
    args.userId,
    args.botId
  )) as { id: string } | undefined;

  if (existing?.id) return existing.id;

  const id = makeId("convo");
  await db.run(
    `INSERT INTO conversations (id, agency_id, user_id, bot_id, summary, message_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    args.agencyId,
    args.userId,
    args.botId,
    null,
    0,
    nowIso(),
    nowIso()
  );

  return id;
}

export async function POST(req: NextRequest) {
  try {
    await ensureChatTables();

    const ctx = await requireActiveMember(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const botId = String(body?.bot_id ?? "").trim();
    if (!botId) return Response.json({ error: "Missing bot_id" }, { status: 400 });

    const db: Db = await getDb();

    // ✅ enforce: agency bot OR user's private bot
    await assertBotAccess(db, { bot_id: botId, agency_id: ctx.agencyId, user_id: ctx.userId });

    // ✅ convo is keyed by agency + user + bot
    const convoId = await getOrCreateConversationId(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      botId,
    });

    // Reset summary + message_count
    await db.run(
      `UPDATE conversations
       SET summary = NULL,
           message_count = 0,
           updated_at = ?
       WHERE id = ? AND agency_id = ? AND user_id = ? AND bot_id = ?`,
      nowIso(),
      convoId,
      ctx.agencyId,
      ctx.userId,
      botId
    );

    // Wipe message history
    await db.run(`DELETE FROM conversation_messages WHERE conversation_id = ?`, convoId);

    return Response.json({ ok: true, bot_id: botId });
  } catch (err: any) {
    const msg = String(err?.message ?? err);

    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "BOT_NOT_FOUND") return Response.json({ error: "Bot not found" }, { status: 404 });
    if (msg === "FORBIDDEN_BOT") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("RESET_CONVERSATION_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
