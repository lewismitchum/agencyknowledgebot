// app/api/bots/[botId]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BotRow = {
  id: string;
  agency_id: string;
  name: string | null;
  owner_user_id: string | null;
  vector_store_id: string | null;
};

function isOwnerOrAdmin(role: any) {
  const r = String(role ?? "").toLowerCase();
  return r === "owner" || r === "admin";
}

export async function PATCH(req: NextRequest, context: { params: { botId: string } }) {
  try {
    const authed: any = await requireActiveMember(req);

    const id = String(context?.params?.botId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_BOT_ID" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as any;
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "MISSING_NAME" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    const bot = (await db.get(
      `SELECT id, agency_id, name, owner_user_id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      authed.agencyId
    )) as BotRow | undefined;

    if (!bot?.id) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const isPrivate = !!bot.owner_user_id;

    // ✅ permissions
    // - private bot: only owner_user_id can rename
    // - agency bot: owner/admin can rename
    if (isPrivate) {
      if (String(bot.owner_user_id) !== String(authed.userId)) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN_PRIVATE_BOT" }, { status: 403 });
      }
    } else {
      if (!isOwnerOrAdmin(authed.role)) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
      }
    }

    await db.run(
      `UPDATE bots
       SET name = ?
       WHERE id = ? AND agency_id = ?`,
      name,
      id,
      authed.agencyId
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE")
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });

    console.error("BOT_PATCH_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: code }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: { botId: string } }) {
  try {
    const authed: any = await requireActiveMember(req);

    const id = String(context?.params?.botId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_BOT_ID" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    const bot = (await db.get(
      `SELECT id, agency_id, name, owner_user_id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      authed.agencyId
    )) as BotRow | undefined;

    if (!bot?.id) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const isPrivate = !!bot.owner_user_id;

    // ✅ permissions
    // - private bot: only owner_user_id can delete
    // - agency bot: owner/admin can delete
    if (isPrivate) {
      if (String(bot.owner_user_id) !== String(authed.userId)) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN_PRIVATE_BOT" }, { status: 403 });
      }
    } else {
      if (!isOwnerOrAdmin(authed.role)) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
      }
    }

    // Best-effort delete vector store
    const vs = String(bot.vector_store_id ?? "").trim();
    if (vs) {
      try {
        await openai.vectorStores.delete(vs);
      } catch (e) {
        console.warn("BOT_VECTOR_STORE_DELETE_FAILED", e);
      }
    }

    // Delete derived documents for this bot (safe)
    await db.run(`DELETE FROM documents WHERE agency_id = ? AND bot_id = ?`, authed.agencyId, id).catch(() => {});

    // Delete conversation rows for this bot+user (safe cleanup; doesn’t touch other users' convos)
    await db
      .run(
        `DELETE FROM conversations
         WHERE agency_id = ? AND bot_id = ? AND owner_user_id = ?`,
        authed.agencyId,
        id,
        authed.userId
      )
      .catch(() => {});
    // conversation_messages has FK-ish by conversation_id; but we don't know if enforced
    // If you have no FK cascade, leave messages to be cleaned by summarize/reset. (safe)

    // Finally delete bot row
    await db.run(`DELETE FROM bots WHERE agency_id = ? AND id = ?`, authed.agencyId, id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE")
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });

    console.error("BOT_DELETE_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: code }, { status: 500 });
  }
}