// app/api/bots/private/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember } from "@/lib/authz";
import { getPlanLimits } from "@/lib/plans";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function makeId(prefix: string) {
  const c: any = (globalThis as any).crypto;
  const uuid =
    c && typeof c.randomUUID === "function"
      ? c.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function tryCreateVectorStore(name: string) {
  try {
    const vs = await openai.vectorStores.create({ name });
    return { ok: true as const, id: vs.id, error: null as string | null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.error("VECTOR_STORE_CREATE_FAILED", msg);
    return { ok: false as const, id: null as string | null, error: msg };
  }
}

function pickMaxPrivateBotsFromLimits(limits: any): number | null {
  const raw = limits?.max_private_bots ?? limits?.private_bots ?? limits?.user_bots ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const bots = await db.all(
      `SELECT id, name, description, owner_user_id, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC`,
      ctx.agencyId,
      ctx.userId
    );

    return NextResponse.json({ ok: true, bots: bots ?? [] });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Pending approval" }, { status: 403 });

    console.error("BOTS_PRIVATE_GET_ERROR", err);
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;

    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    // Optional: enforce private bot cap by plan
    const limits = getPlanLimits(ctx.plan);
    const maxPrivateBots = pickMaxPrivateBotsFromLimits(limits);

    if (maxPrivateBots != null) {
      const row = (await db.get(
        `SELECT COUNT(*) as c
         FROM bots
         WHERE agency_id = ? AND owner_user_id = ?`,
        ctx.agencyId,
        ctx.userId
      )) as { c: number } | undefined;

      const current = Number(row?.c ?? 0);
      if (current >= Number(maxPrivateBots)) {
        return NextResponse.json(
          {
            ok: false,
            error: "BOT_LIMIT_EXCEEDED",
            plan: ctx.plan,
            kind: "private_bot",
            used: current,
            limit: Number(maxPrivateBots),
          },
          { status: 403 }
        );
      }
    }

    const vs = await tryCreateVectorStore(
      `Louis.Ai • Private Bot • ${name} • ${ctx.agencyId} • ${ctx.userId}`
    );
    const botId = makeId("bot");

    await db.run(
      `INSERT INTO bots (id, agency_id, owner_user_id, name, description, vector_store_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      botId,
      ctx.agencyId,
      ctx.userId,
      name,
      description,
      vs.id,
      new Date().toISOString()
    );

    const created = (await db.get(
      `SELECT id, name, description, owner_user_id, vector_store_id, created_at
       FROM bots
       WHERE id = ?
       LIMIT 1`,
      botId
    )) as
      | {
          id: string;
          name: string;
          description: string | null;
          owner_user_id: string | null;
          vector_store_id: string | null;
          created_at: string;
        }
      | undefined;

    return NextResponse.json({
      ok: true,
      bot: created ?? null,
      warning: vs.ok
        ? null
        : "Vector store creation failed (bot created, but uploads/chat won’t work until quota/billing is OK).",
      openai_error: vs.ok ? null : vs.error,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Pending approval" }, { status: 403 });

    console.error("BOTS_PRIVATE_POST_ERROR", err);
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}