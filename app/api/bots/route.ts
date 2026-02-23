// app/api/bots/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, normalizePlan } from "@/lib/plans";
import { requireActiveMember, requireOwnerOrAdmin } from "@/lib/authz";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type Ctx = {
  agencyId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  plan?: string | null;
};

type BotRow = {
  id: string;
  agency_id: string;
  name: string | null;
  owner_user_id: string | null;
  vector_store_id: string | null;
  created_at: string | null;
};

function pickMaxAgencyBotsFromLimits(limits: any): number | null {
  const raw =
    limits?.max_agency_bots ??
    limits?.agency_bots ??
    limits?.max_bots ??
    limits?.bots ??
    null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function getAgencyPlan(db: Db, agencyId: string, fallbackPlan: string | null) {
  const row = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan: string | null }
    | undefined;
  return normalizePlan(row?.plan ?? fallbackPlan ?? null);
}

function bad(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = (await requireActiveMember(req)) as Ctx;

    const db: Db = await getDb();
    await ensureSchema(db);

    const bots = (await db.all(
      `SELECT id, agency_id, name, owner_user_id, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       ORDER BY created_at DESC`,
      ctx.agencyId,
      ctx.userId
    )) as BotRow[];

    const normalized = (bots ?? []).map((b) => ({
      id: b.id,
      name: b.name ?? "Untitled Bot",
      scope: b.owner_user_id ? "private" : "agency",
      owner_user_id: b.owner_user_id,
      vector_store_id: b.vector_store_id,
      created_at: b.created_at,
    }));

    return NextResponse.json({ ok: true, bots: normalized });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    console.error("BOTS_GET_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Create bot (agency: owner/admin only + plan limit; private: any active member; private does NOT count).
  try {
    // We accept either owner/admin context (for agency bot) or active member (for private bot).
    const body = (await req.json().catch(() => ({}))) as any;
    const scopeRaw = String(body?.scope ?? body?.type ?? "agency").toLowerCase();
    const scope = scopeRaw === "private" ? "private" : "agency";
    const name = String(body?.name ?? "").trim();

    if (!name) return bad("MISSING_NAME");

    const ctx = (scope === "agency"
      ? ((await requireOwnerOrAdmin(req)) as Ctx)
      : ((await requireActiveMember(req)) as Ctx)) as Ctx;

    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
    const maxAgencyBots = pickMaxAgencyBotsFromLimits(limits);

    if (scope === "agency") {
      if (maxAgencyBots != null) {
        const row = (await db.get(
          `SELECT COUNT(1) as n
           FROM bots
           WHERE agency_id = ? AND owner_user_id IS NULL`,
          ctx.agencyId
        )) as { n: number } | undefined;

        const used = Number(row?.n ?? 0);
        if (used >= maxAgencyBots) {
          return NextResponse.json(
            { ok: false, error: "BOT_LIMIT_REACHED", bots: { used, limit: maxAgencyBots } },
            { status: 403 }
          );
        }
      }
    }

    // Create vector store now (so bots never ship without it)
    const vs = await openai.vectorStores.create({ name });

    const id = crypto.randomUUID();
    const ownerUserId = scope === "private" ? ctx.userId : null;

    await db.run(
      `INSERT INTO bots (id, agency_id, name, owner_user_id, vector_store_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      ctx.agencyId,
      name,
      ownerUserId,
      vs.id,
      new Date().toISOString()
    );

    return NextResponse.json({
      ok: true,
      bot: {
        id,
        name,
        scope,
        owner_user_id: ownerUserId,
        vector_store_id: vs.id,
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);

    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_ADMIN_OR_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ADMIN_OR_OWNER" }, { status: 403 });
    }
    if (msg === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_OWNER" }, { status: 403 });
    }

    console.error("BOTS_POST_ERROR", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR", message: msg }, { status: 500 });
  }
}