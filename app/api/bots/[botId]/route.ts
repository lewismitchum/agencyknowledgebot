// app/api/bots/[botId]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireOwnerOrAdmin } from "@/lib/authz";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureBotColumns(db: Db) {
  await db.run(`ALTER TABLE bots ADD COLUMN name TEXT`).catch(() => {});
  await db.run(`ALTER TABLE bots ADD COLUMN is_agency INTEGER`).catch(() => {});
  await db.run(`ALTER TABLE bots ADD COLUMN user_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE bots ADD COLUMN vector_store_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE bots ADD COLUMN created_at TEXT`).catch(() => {});
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ botId: string }> }) {
  try {
    const authed = await requireOwnerOrAdmin(req);

    const { botId } = await ctx.params;
    const id = String(botId || "").trim();
    if (!id) return NextResponse.json({ error: "Missing botId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureBotColumns(db);

    const bot = (await db.get(
      `SELECT id, agency_id, is_agency, user_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      authed.agencyId
    )) as { id: string; agency_id: string; is_agency: number | null; user_id: string | null } | undefined;

    if (!bot?.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAgency = Number(bot.is_agency ?? 0) === 1;

    // ✅ owner/admin can rename agency bots
    // (private bots are owned by users; if you want admin rename those too, remove this)
    if (!isAgency) {
      return NextResponse.json({ error: "FORBIDDEN_PRIVATE_BOT" }, { status: 403 });
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
    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (code === "FORBIDDEN_NOT_ADMIN_OR_OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ botId: string }> }) {
  try {
    const authed = await requireOwnerOrAdmin(req);

    const { botId } = await ctx.params;
    const id = String(botId || "").trim();
    if (!id) return NextResponse.json({ error: "Missing botId" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureBotColumns(db);

    const bot = (await db.get(
      `SELECT id, agency_id, is_agency, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      authed.agencyId
    )) as { id: string; agency_id: string; is_agency: number | null; vector_store_id: string | null } | undefined;

    if (!bot?.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAgency = Number(bot.is_agency ?? 0) === 1;

    // ✅ owner/admin can delete agency bots
    if (!isAgency) {
      return NextResponse.json({ error: "FORBIDDEN_PRIVATE_BOT" }, { status: 403 });
    }

    // Best effort: delete vector store (don’t block deletion if it fails)
    const vs = String(bot.vector_store_id ?? "").trim();
    if (vs) {
      try {
        // prefer existing SDK method if present, otherwise fall back to generic request
        const vsApi: any = (openai as any).vectorStores;
        if (typeof vsApi?.del === "function") {
          await vsApi.del(vs);
        } else if (typeof vsApi?.delete === "function") {
          await vsApi.delete(vs);
        } else if (typeof (openai as any).request === "function") {
          await (openai as any).request({ method: "DELETE", path: `/v1/vector-stores/${vs}` });
        } else {
          throw new Error("No vector store delete method available on OpenAI client");
        }
      } catch (e) {
        console.warn("BOT_VECTOR_STORE_DELETE_FAILED", e);
      }
    }

    // Delete derived docs rows for this bot (safe)
    await db.run(`DELETE FROM documents WHERE agency_id = ? AND bot_id = ?`, authed.agencyId, id).catch(() => {});

    // Delete bot row
    await db.run(`DELETE FROM bots WHERE agency_id = ? AND id = ?`, authed.agencyId, id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (code === "FORBIDDEN_NOT_ADMIN_OR_OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}