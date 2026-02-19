// app/api/bots/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { getOrCreateUser } from "@/lib/users";
import { requireActiveMember, requireOwner } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
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

async function getAgencyPlan(db: Db, agencyId: string, fallbackPlan: string | null) {
  const planRow = (await db.get(
    `SELECT plan FROM agencies WHERE id = ? LIMIT 1`,
    agencyId
  )) as { plan: string | null } | undefined;

  return normalizePlan(planRow?.plan ?? fallbackPlan ?? null);
}

/**
 * Ensures there is at least 1 agency bot.
 * Does NOT silently repair vector stores.
 */
async function ensureDefaultAgencyBot(db: Db, agencyId: string) {
  const existing = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    agencyId
  )) as { id: string } | undefined;

  if (existing?.id) return;

  const botId = makeId("bot");
  const defaultName = "Agency Bot";
  const vs = await tryCreateVectorStore(
    `Louis.Ai • Agency Bot • ${defaultName} • ${agencyId}`
  );

  await db.run(
    `INSERT INTO bots
     (id, agency_id, owner_user_id, name, description, vector_store_id, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    botId,
    agencyId,
    defaultName,
    "Shared agency bot",
    vs.id,
    new Date().toISOString()
  );
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const user = await getOrCreateUser(ctx.agencyId, ctx.agencyEmail);

    await ensureDefaultAgencyBot(db, ctx.agencyId);

    const bots = (await db.all(
      `SELECT id, agency_id, owner_user_id, name, description, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       ORDER BY
         CASE WHEN owner_user_id IS NULL THEN 0 ELSE 1 END,
         created_at DESC`,
      ctx.agencyId,
      user.id
    )) as Array<{
      id: string;
      agency_id: string;
      owner_user_id: string | null;
      name: string;
      description: string | null;
      vector_store_id: string | null;
      created_at: string;
    }>;

    return NextResponse.json({ ok: true, bots: bots ?? [] });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    console.error("BOTS_GET_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    await getOrCreateUser(ctx.agencyId, ctx.agencyEmail);

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description =
      typeof body?.description === "string" ? body.description.trim() : null;

    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const limits = getPlanLimits(plan);

    const maxAgencyBots =
      limits?.max_agency_bots ?? limits?.agency_bots ?? null;

    if (maxAgencyBots != null) {
      const row = (await db.get(
        `SELECT COUNT(*) as c
         FROM bots
         WHERE agency_id = ? AND owner_user_id IS NULL`,
        ctx.agencyId
      )) as { c: number } | undefined;

      const current = Number(row?.c ?? 0);
      if (current >= Number(maxAgencyBots)) {
        return NextResponse.json(
          {
            ok: false,
            error: "BOT_LIMIT_EXCEEDED",
            plan,
            kind: "agency_bot",
            used: current,
            limit: maxAgencyBots,
          },
          { status: 403 }
        );
      }
    }

    const vs = await tryCreateVectorStore(
      `Louis.Ai • Agency Bot • ${name} • ${ctx.agencyId}`
    );
    const botId = makeId("bot");

    await db.run(
      `INSERT INTO bots
       (id, agency_id, owner_user_id, name, description, vector_store_id, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      botId,
      ctx.agencyId,
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
        : "Vector store creation failed (bot created, but uploads/chat won’t work until billing/quota is fixed).",
      openai_error: vs.ok ? null : vs.error,
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (code === "FORBIDDEN_NOT_OWNER")
      return NextResponse.json({ error: "Owner only" }, { status: 403 });

    console.error("BOTS_POST_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
