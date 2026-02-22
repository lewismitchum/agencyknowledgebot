// app/api/bots/[botId]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
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

type RouteCtx = { params: Promise<{ botId: string }> };

export async function DELETE(req: NextRequest, context: RouteCtx) {
  try {
    const session = await requireActiveMember(req);

    const { botId } = await context.params;
    const id = String(botId || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "Missing botId" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    // IMPORTANT: user.id is the actual users table id (not agency email)
    const user = await getOrCreateUser(session.agencyId, session.agencyEmail);

    const bot = (await db.get(
      `SELECT id, agency_id, owner_user_id, name, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      session.agencyId
    )) as BotRow | undefined;

    if (!bot?.id) {
      return NextResponse.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    // HARD RULES:
    // - Never delete agency bots here
    // - Only delete your own private bots
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

    // Delete docs owned by this user for this bot
    const docs = (await db.all(
      `SELECT id, openai_file_id
       FROM documents
       WHERE agency_id = ?
         AND bot_id = ?
         AND owner_user_id = ?`,
      session.agencyId,
      bot.id,
      user.id
    )) as Array<{ id: string; openai_file_id: string | null }>;

    // Best-effort: remove files from vector store
    if (bot.vector_store_id) {
      for (const d of docs) {
        if (!d.openai_file_id) continue;
        try {
          await (openai as any).vectorStores.files.del(bot.vector_store_id, d.openai_file_id);
        } catch {}
      }
    }

    // Remove derived data
    for (const d of docs) {
      await db.run(
        `DELETE FROM schedule_events WHERE agency_id = ? AND bot_id = ? AND document_id = ?`,
        session.agencyId,
        bot.id,
        d.id
      );
      await db.run(
        `DELETE FROM schedule_tasks WHERE agency_id = ? AND bot_id = ? AND document_id = ?`,
        session.agencyId,
        bot.id,
        d.id
      );
      await db.run(
        `DELETE FROM extractions WHERE agency_id = ? AND bot_id = ? AND document_id = ?`,
        session.agencyId,
        bot.id,
        d.id
      );
    }

    // Delete docs rows
    await db.run(
      `DELETE FROM documents
       WHERE agency_id = ? AND bot_id = ? AND owner_user_id = ?`,
      session.agencyId,
      bot.id,
      user.id
    );

    // Delete conversations for this private bot owned by this user
    await db.run(
      `DELETE FROM conversation_messages
       WHERE conversation_id IN (
         SELECT id FROM conversations WHERE agency_id = ? AND bot_id = ? AND owner_user_id = ?
       )`,
      session.agencyId,
      bot.id,
      user.id
    );

    await db.run(
      `DELETE FROM conversations
       WHERE agency_id = ? AND bot_id = ? AND owner_user_id = ?`,
      session.agencyId,
      bot.id,
      user.id
    );

    // Delete the bot row
    await db.run(
      `DELETE FROM bots
       WHERE id = ? AND agency_id = ? AND owner_user_id = ?`,
      bot.id,
      session.agencyId,
      user.id
    );

    // Best-effort: delete vector store
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