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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const url = new URL(req.url);
    let bot_id = String(url.searchParams.get("bot_id") || "").trim();

    const db: Db = await getDb();

    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) {
        return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      }
      bot_id = fallback;
    }

    await assertBotAccess(db, { bot_id, agency_id: ctx.agencyId, user_id: ctx.userId });

    // NOTE: schema.ts defines documents.title (not filename)
    const documents = await db.all(
      `SELECT id, title, openai_file_id, created_at
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

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    if (msg === "FORBIDDEN_BOT") return Response.json({ ok: false, error: "FORBIDDEN_BOT" }, { status: 403 });

    console.error("DOCUMENTS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

// Some parts of the app may POST to /api/documents. If uploads are implemented elsewhere,
// this keeps the route module valid and avoids confusing build/runtime behavior.
export async function POST(req: NextRequest) {
  try {
    await requireActiveMember(req);

    return Response.json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
        hint: "Uploads are not handled by POST /api/documents in this build. Use the upload endpoint used by the UI.",
      },
      { status: 405 }
    );
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}
