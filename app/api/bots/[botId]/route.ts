// app/api/bots/[botId]/route.ts
import { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ botId: string }> }) {
  try {
    const { botId } = await ctx.params;

    const me = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const bot = (await db.get(
      `SELECT id, owner_user_id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      botId,
      me.agencyId
    )) as { id: string; owner_user_id: string | null; vector_store_id: string | null } | undefined;

    if (!bot?.id) {
      return Response.json({ error: "Bot not found" }, { status: 404 });
    }

    const isAgencyBot = !bot.owner_user_id;

    // Permissions:
    // - agency bot: owner only
    // - user bot: only the owner_user_id can delete it
    if (isAgencyBot) {
      if (me.role !== "owner") {
        return Response.json({ error: "Owner only" }, { status: 403 });
      }
    } else {
      if (bot.owner_user_id !== me.userId) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Best-effort cleanup helpers
    const cleanup = async (sql: string, ...params: any[]) => {
      try {
        await db.run(sql, ...params);
      } catch {}
    };

    // Remove derived/related rows (best-effort)
    await cleanup(`DELETE FROM documents WHERE agency_id = ? AND bot_id = ?`, me.agencyId, botId);
    await cleanup(`DELETE FROM schedule_events WHERE agency_id = ? AND bot_id = ?`, me.agencyId, botId);
    await cleanup(`DELETE FROM schedule_tasks WHERE agency_id = ? AND bot_id = ?`, me.agencyId, botId);
    await cleanup(`DELETE FROM extractions WHERE agency_id = ? AND bot_id = ?`, me.agencyId, botId);

    // Conversations are keyed by bot_id on conversations, but messages only reference conversation_id.
    await cleanup(
      `DELETE FROM conversation_messages
       WHERE conversation_id IN (SELECT id FROM conversations WHERE agency_id = ? AND bot_id = ?)`,
      me.agencyId,
      botId
    );
    await cleanup(`DELETE FROM conversations WHERE agency_id = ? AND bot_id = ?`, me.agencyId, botId);

    // Delete bot row (scoped)
    if (isAgencyBot) {
      await db.run(
        `DELETE FROM bots
         WHERE id = ? AND agency_id = ? AND owner_user_id IS NULL`,
        botId,
        me.agencyId
      );
    } else {
      await db.run(
        `DELETE FROM bots
         WHERE id = ? AND agency_id = ? AND owner_user_id = ?`,
        botId,
        me.agencyId,
        me.userId
      );
    }

    // Best-effort: delete vector store too (safe if it fails)
    if (bot.vector_store_id) {
      try {
        // Official SDK shape: openai.vectorStores.del(vectorStoreId)
        const vs: any = (openai as any).vectorStores;
        if (vs?.del) await vs.del(bot.vector_store_id);
        else if (vs?.delete) await vs.delete(bot.vector_store_id);
      } catch {}
    }

    return Response.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("BOTS_DELETE_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}