// app/api/bots/[botId]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember, requireOwnerOrAdmin } from "@/lib/authz";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureBotColumns(db: Db) {
  await db.run(`ALTER TABLE bots ADD COLUMN name TEXT`).catch(() => {});
  await db.run(`ALTER TABLE bots ADD COLUMN owner_user_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE bots ADD COLUMN vector_store_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE bots ADD COLUMN created_at TEXT`).catch(() => {});
}

async function bestEffortDeleteVectorStore(vectorStoreId: string) {
  const vs = String(vectorStoreId ?? "").trim();
  if (!vs) return;

  try {
    const api: any = (openai as any).vectorStores;
    if (typeof api?.del === "function") {
      await api.del(vs);
      return;
    }
    if (typeof api?.delete === "function") {
      await api.delete(vs);
      return;
    }
    if (typeof (openai as any).request === "function") {
      await (openai as any).request({ method: "DELETE", path: `/v1/vector-stores/${vs}` });
      return;
    }
  } catch (e) {
    console.warn("BOT_VECTOR_STORE_DELETE_FAILED", e);
  }
}

async function deleteBotData(db: Db, agencyId: string, botId: string) {
  await db.run(`DELETE FROM documents WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
  await db.run(`DELETE FROM schedule_events WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
  await db.run(`DELETE FROM schedule_tasks WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
  await db.run(`DELETE FROM extractions WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});

  await db
    .run(
      `DELETE FROM conversation_messages
       WHERE conversation_id IN (
         SELECT id FROM conversations WHERE agency_id = ? AND bot_id = ?
       )`,
      agencyId,
      botId
    )
    .catch(() => {});
  await db.run(`DELETE FROM conversations WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ botId: string }> }) {
  try {
    const member = await requireActiveMember(req);

    const { botId } = await ctx.params;
    const id = String(botId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_BOT_ID" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const name = String((body as any)?.name ?? "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "MISSING_NAME" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureBotColumns(db);

    const bot = (await db.get(
      `SELECT id, agency_id, owner_user_id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      member.agencyId
    )) as
      | { id: string; agency_id: string; owner_user_id: string | null; vector_store_id: string | null }
      | undefined;

    if (!bot?.id) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const isPrivate = !!String(bot.owner_user_id ?? "").trim();

    if (isPrivate) {
      if (String(bot.owner_user_id) !== String(member.userId)) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN_PRIVATE_BOT" }, { status: 403 });
      }
    } else {
      await requireOwnerOrAdmin(req);
    }

    await db.run(
      `UPDATE bots
       SET name = ?
       WHERE id = ? AND agency_id = ?`,
      name,
      id,
      member.agencyId
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    if (code === "FORBIDDEN_NOT_ADMIN_OR_OWNER")
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });

    console.error("BOT_PATCH_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: code }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ botId: string }> }) {
  try {
    const member = await requireActiveMember(req);

    const { botId } = await ctx.params;
    const id = String(botId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_BOT_ID" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureBotColumns(db);

    const bot = (await db.get(
      `SELECT id, agency_id, owner_user_id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      member.agencyId
    )) as
      | { id: string; agency_id: string; owner_user_id: string | null; vector_store_id: string | null }
      | undefined;

    if (!bot?.id) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const isPrivate = !!String(bot.owner_user_id ?? "").trim();

    if (isPrivate) {
      if (String(bot.owner_user_id) !== String(member.userId)) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN_PRIVATE_BOT" }, { status: 403 });
      }
    } else {
      await requireOwnerOrAdmin(req);
    }

    await bestEffortDeleteVectorStore(String(bot.vector_store_id ?? ""));

    await deleteBotData(db, member.agencyId, id);

    await db.run(`DELETE FROM bots WHERE agency_id = ? AND id = ?`, member.agencyId, id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    if (code === "FORBIDDEN_NOT_ADMIN_OR_OWNER")
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });

    console.error("BOT_DELETE_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: code }, { status: 500 });
  }
}