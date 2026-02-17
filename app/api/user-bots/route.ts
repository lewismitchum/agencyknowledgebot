import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type Body = {
  name?: string;
  description?: string | null;
};

async function tryCreateVectorStore(name: string, agencyId: string, userId: string) {
  try {
    const vs = await openai.vectorStores.create({
      name: `Louis.Ai • User Bot • ${name} • ${agencyId} • ${userId}`,
    });
    return { ok: true as const, id: vs.id, error: null as string | null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.error("USER_BOT_VECTOR_STORE_FAILED", msg);
    return { ok: false as const, id: null as string | null, error: msg };
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    const bots = await db.all(
      `SELECT id, name, description, owner_user_id, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC`,
      ctx.agencyId,
      ctx.userId
    );

    return Response.json({ ok: true, bots: bots ?? [] });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });

    console.error("LIST_USER_BOTS_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const body = (await req.json().catch(() => null)) as Body | null;
    const name = String(body?.name ?? "").trim();
    const description = typeof body?.description === "string" ? body.description.trim() : null;

    if (!name) return Response.json({ error: "Missing name" }, { status: 400 });

    const db: Db = await getDb();

    const vs = await tryCreateVectorStore(name, ctx.agencyId, ctx.userId);

    await db.run(
      `INSERT INTO bots (id, agency_id, owner_user_id, name, description, vector_store_id)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)`,
      ctx.agencyId,
      ctx.userId,
      name,
      description || null,
      vs.id
    );

    const created = await db.get(
      `SELECT id, name, description, owner_user_id, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ? AND owner_user_id = ? AND name = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId,
      name
    );

    return Response.json({
      ok: true,
      bot: created ?? null,
      warning: vs.ok
        ? null
        : "Vector store creation failed (bot created, but uploads/chat won’t work until quota/billing is OK).",
      openai_error: vs.ok ? null : vs.error,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });

    console.error("CREATE_USER_BOT_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
