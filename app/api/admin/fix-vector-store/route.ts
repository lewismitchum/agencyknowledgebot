import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember, requireOwner } from "@/lib/authz";

export const runtime = "nodejs";

type Ctx = {
  agencyId: string;
  userId: string;
};

export async function GET(req: NextRequest) {
  try {
    const ctx = (await requireActiveMember(req)) as Ctx;

    const url = new URL(req.url);
    const botId = String(url.searchParams.get("bot_id") || "").trim();

    if (!botId) {
      return Response.json({ ok: false, error: "Missing bot_id" }, { status: 400 });
    }

    const db: Db = await getDb();

    const bot = (await db.get(
      `SELECT id, name, owner_user_id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      botId,
      ctx.agencyId,
      ctx.userId
    )) as
      | { id: string; name: string; owner_user_id: string | null; vector_store_id: string | null }
      | undefined;

    if (!bot?.id) {
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    return Response.json({ ok: true, bot });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("REPAIR_VECTOR_STORE_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = (await requireActiveMember(req)) as Ctx;

    const body = await req.json().catch(() => ({}));
    const botId = String((body as any)?.bot_id || "").trim();

    if (!botId) {
      return Response.json({ ok: false, error: "Missing bot_id" }, { status: 400 });
    }

    const db: Db = await getDb();

    const bot = (await db.get(
      `SELECT id, name, owner_user_id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      botId,
      ctx.agencyId
    )) as
      | { id: string; name: string; owner_user_id: string | null; vector_store_id: string | null }
      | undefined;

    if (!bot?.id) {
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    // Permission:
    // - user bot: only the owner user can repair
    // - agency bot: only agency owner can repair (canonical helper)
    if (bot.owner_user_id) {
      if (bot.owner_user_id !== ctx.userId) {
        return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    } else {
      requireOwner(req);
    }

    if (bot.vector_store_id) {
      return Response.json({
        ok: true,
        message: "Vector store already exists",
        vector_store_id: bot.vector_store_id,
      });
    }

    const vs = await openai.vectorStores.create({ name: `louis-bot-${bot.id}` });
    const vectorStoreId = String((vs as any)?.id || "");
    if (!vectorStoreId) {
      return Response.json({ ok: false, error: "Failed to create vector store" }, { status: 502 });
    }

    await db.run(
      `UPDATE bots
       SET vector_store_id = ?
       WHERE id = ? AND agency_id = ?`,
      vectorStoreId,
      bot.id,
      ctx.agencyId
    );

    return Response.json({ ok: true, vector_store_id: vectorStoreId });
  } catch (err: any) {
    const msg = String(err?.message ?? err);

    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return Response.json({ error: "Forbidden" }, { status: 403 });

    if (/quota|billing|insufficient|rate limit/i.test(msg)) {
      return Response.json({ ok: false, error: msg }, { status: 402 });
    }

    console.error("REPAIR_VECTOR_STORE_POST_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
