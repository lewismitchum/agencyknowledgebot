// app/api/bots/[botId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getOrCreateUser } from "@/lib/users";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type BotRow = {
  id: string;
  agency_id: string;
  owner_user_id: string | null;
  name: string;
  vector_store_id: string | null;
};

export async function DELETE(req: NextRequest, ctx: { params: { botId: string } }) {
  try {
    const session = await requireActiveMember(req);

    const botId = String(ctx?.params?.botId || "").trim();
    if (!botId) return NextResponse.json({ ok: false, error: "Missing botId" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    const user = await getOrCreateUser(session.agencyId, session.agencyEmail);

    const bot = (await db.get(
      `SELECT id, agency_id, owner_user_id, name, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      botId,
      session.agencyId
    )) as BotRow | undefined;

    if (!bot?.id) {
      return NextResponse.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    // ✅ HARD RULES:
    // - You can NEVER delete agency bots here
    // - You can ONLY delete your own private user bots
    if (!bot.owner_user_id) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Agency bots cannot be deleted." },
        { status: 403 }
      );
    }

    if (bot.owner_user_id !== user.id) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "You can only delete your own private bots." },
        { status: 403 }
      );
    }

    // Delete docs owned by this user for this bot (and any derived schedule/extractions)
    const docs = (await db.all(
      `SELECT id, openai_file_id
       FROM documents
       WHERE agency_id = ?
         AND bot_id = ?
         AND owner_user_id = ?`,
      session.agencyId,
      botId,
      user.id
    )) as Array<{ id: string; openai_file_id: string | null }>;

    // Best-effort: remove files from the bot's vector store first
    if (bot.vector_store_id) {
      for (const d of docs) {
        if (!d.openai_file_id) continue;
        try {
          // If the file isn't there / already deleted, this throws; ignore.
          await (openai as any).vectorStores.files.del(bot.vector_store_id, d.openai_file_id);
        } catch {}
      }
    }

    // Remove derived data
    for (const d of docs) {
      await db.run(
        `DELETE FROM schedule_events WHERE agency_id = ? AND bot_id = ? AND document_id = ?`,
        session.agencyId,
        botId,
        d.id
      );
      await db.run(
        `DELETE FROM schedule_tasks WHERE agency_id = ? AND bot_id = ? AND document_id = ?`,
        session.agencyId,
        botId,
        d.id
      );
      await db.run(
        `DELETE FROM extractions WHERE agency_id = ? AND bot_id = ? AND document_id = ?`,
        session.agencyId,
        botId,
        d.id
      );
    }

    // Delete docs rows
    await db.run(
      `DELETE FROM documents
       WHERE agency_id = ? AND bot_id = ? AND owner_user_id = ?`,
      session.agencyId,
      botId,
      user.id
    );

    // Delete conversations for this bot owned by this user (if you store private bot convos as owner_user_id=user.id)
    await db.run(
      `DELETE FROM conversation_messages
       WHERE conversation_id IN (
         SELECT id FROM conversations WHERE agency_id = ? AND bot_id = ? AND owner_user_id = ?
       )`,
      session.agencyId,
      botId,
      user.id
    );

    await db.run(
      `DELETE FROM conversations
       WHERE agency_id = ? AND bot_id = ? AND owner_user_id = ?`,
      session.agencyId,
      botId,
      user.id
    );

    // Delete the bot row
    await db.run(
      `DELETE FROM bots
       WHERE id = ? AND agency_id = ? AND owner_user_id = ?`,
      botId,
      session.agencyId,
      user.id
    );

    // Best-effort: delete vector store (safe because user bots are per-user)
    if (bot.vector_store_id) {
      try {
        await (openai as any).vectorStores.del(bot.vector_store_id);
      } catch {}
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    console.error("BOT_DELETE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}