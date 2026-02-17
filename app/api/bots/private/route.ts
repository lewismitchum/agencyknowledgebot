// app/api/bots/private/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { getOrCreateUser } from "@/lib/users";
import { requireActiveMember } from "@/lib/authz";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

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
  const planRow = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan: string | null }
    | undefined;

  return normalizePlan(planRow?.plan ?? fallbackPlan ?? null);
}

function pickMaxPrivateBotsFromLimits(limits: any): number | null {
  const raw = limits?.max_private_bots ?? limits?.private_bots ?? limits?.user_bots ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    // ✅ canonical auth (enforces active member + gives agencyId/userId)
    const ctx = await requireActiveMember(req);

    // Ensure user exists (private bots belong to a user row)
    const user = await getOrCreateUser(ctx.agencyId, ctx.agencyEmail);

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;

    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const db: Db = await getDb();

    // ✅ Enforce private bot count by plan (optional — only if you actually want private bots enabled)
    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const limits = getPlanLimits(plan);
    const maxPrivateBots = pickMaxPrivateBotsFromLimits(limits);

    if (maxPrivateBots != null) {
      const row = (await db.get(
        `SELECT COUNT(*) as c
         FROM bots
         WHERE agency_id = ? AND owner_user_id = ?`,
        ctx.agencyId,
        user.id
      )) as { c: number } | undefined;

      const current = Number(row?.c ?? 0);
      if (current >= maxPrivateBots) {
        return NextResponse.json(
          {
            ok: false,
            error: "BOT_LIMIT_EXCEEDED",
            plan,
            kind: "private_bot",
            used: current,
            limit: maxPrivateBots,
          },
          { status: 403 }
        );
      }
    }

    const vs = await tryCreateVectorStore(`Louis.Ai • Private Bot • ${name} • ${ctx.agencyId} • ${user.id}`);
    const botId = makeId("bot");

    await db.run(
      `INSERT INTO bots (id, agency_id, owner_user_id, name, description, vector_store_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      botId,
      ctx.agencyId,
      user.id,
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
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    console.error("BOTS_PRIVATE_POST_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}
