import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ botId: string }> }
) {
  const { botId } = await ctx.params;

  const me = await requireActiveMember(req);
  const db: any = await getDb();

  const bot: any = await db.get(
    `SELECT id, owner_user_id, vector_store_id
     FROM bots
     WHERE id = ? AND agency_id = ?
     LIMIT 1`,
    botId,
    me.agencyId
  );

  if (!bot?.id) {
    return Response.json({ error: "Bot not found" }, { status: 404 });
  }

  const isAgencyBot = !bot.owner_user_id;
  const isUserBot = !!bot.owner_user_id;

  // ✅ Permissions:
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

  // Best-effort cleanup
  const cleanup = async (sql: string, ...params: any[]) => {
    try {
      await db.run(sql, ...params);
    } catch {}
  };

  await cleanup(`DELETE FROM documents WHERE bot_id = ?`, botId);
  await cleanup(`DELETE FROM schedule_events WHERE bot_id = ?`, botId);
  await cleanup(`DELETE FROM schedule_tasks WHERE bot_id = ?`, botId);
  await cleanup(`DELETE FROM extractions WHERE bot_id = ?`, botId);

  // If these columns don’t exist in your schema, cleanup ignores errors
  await cleanup(`DELETE FROM conversation_messages WHERE bot_id = ?`, botId);
  await cleanup(`DELETE FROM conversations WHERE bot_id = ?`, botId);

  // Delete bot row
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
      // Depending on SDK, delete may be .del or .delete
      const vs: any = (openai as any).vectorStores;
      if (vs?.del) await vs.del(bot.vector_store_id);
      else if (vs?.delete) await vs.delete(bot.vector_store_id);
    } catch {}
  }

  return Response.json({ ok: true });
}
