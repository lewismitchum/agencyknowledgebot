// app/api/documents/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";

async function getFallbackBotId(db: Db, agencyId: string, userId: string) {
  const agencyBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId
  )) as { id: string } | undefined;

  if (agencyBot?.id) return agencyBot.id;

  const userBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId,
    userId
  )) as { id: string } | undefined;

  return userBot?.id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const url = new URL(req.url);
    let bot_id = String(url.searchParams.get("bot_id") || "").trim();

    const db: Db = await getDb();

    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) {
        return Response.json({ ok: false, error: "No bots found for this agency/user" }, { status: 404 });
      }
      bot_id = fallback;
    }

    const bot = (await db.get(
      `SELECT id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      bot_id,
      ctx.agencyId,
      ctx.userId
    )) as { id: string } | undefined;

    if (!bot?.id) {
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    const documents = await db.all(
      `SELECT id, filename, openai_file_id, created_at
       FROM documents
       WHERE agency_id = ? AND bot_id = ?
       ORDER BY created_at DESC`,
      ctx.agencyId,
      bot_id
    );

    return Response.json({ ok: true, bot_id, documents: documents ?? [] });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("DOCUMENTS_GET_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
