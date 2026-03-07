// app/api/bots/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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
  const raw = limits?.max_agency_bots ?? limits?.agency_bots ?? limits?.max_bots ?? limits?.bots ?? null;
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

function getRowsAffected(info: any): number {
  const n =
    info?.rowsAffected ??
    info?.rows_affected ??
    info?.changes ??
    info?.affectedRows ??
    info?.affected_rows ??
    0;
  const num = Number(n);
  return Number.isFinite(num) ? num : 0;
}

async function ensureOnboardingColumns(db: Db) {
  const columns = (await db.all(`PRAGMA table_info(users)`)) as Array<{ name?: string }>;

  const hasCreatedFirstBot = columns.some((c) => c?.name === "created_first_bot");

  if (!hasCreatedFirstBot) {
    await db.run(`ALTER TABLE users ADD COLUMN created_first_bot INTEGER NOT NULL DEFAULT 0`);
  }
}

async function markCreatedFirstBot(db: Db, userId: string) {
  await ensureOnboardingColumns(db);
  await db.run(`UPDATE users SET created_first_bot = 1 WHERE id = ?`, userId);
}

async function ensureDefaultAgencyBot(db: Db, agencyId: string) {
  // Idempotent:
  // - If no agency bot exists, create one + vector store.
  // - If agency bot exists but vector_store_id is NULL/empty, repair by creating VS + updating row.
  const existing = (await db.get(
    `SELECT id, name, vector_store_id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    agencyId
  )) as { id: string; name: string | null; vector_store_id: string | null } | undefined;

  if (existing?.id) {
    const vsId = String(existing.vector_store_id ?? "").trim();
    if (vsId) return;

    const vs = await openai.vectorStores.create({ name: existing.name ?? "Agency Bot" });
    await db.run(`UPDATE bots SET vector_store_id = ? WHERE id = ? AND agency_id = ?`, vs.id, existing.id, agencyId);
    return;
  }

  const botId = randomUUID();
  const botName = "Agency Bot";
  const vs = await openai.vectorStores.create({ name: botName });

  try {
    await db.run(
      `INSERT INTO bots (id, agency_id, name, owner_user_id, vector_store_id, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      botId,
      agencyId,
      botName,
      vs.id,
      new Date().toISOString()
    );
  } catch (e) {
    try {
      await openai.vectorStores.delete(vs.id);
    } catch {}
    throw e;
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = (await requireActiveMember(req)) as Ctx;

    const db: Db = await getDb();
    await ensureSchema(db);

    // Never return empty bots / never reintroduce NULL vector_store_id landmine
    await ensureDefaultAgencyBot(db, ctx.agencyId);

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
  // Rules:
  // - Agency bots: owner/admin only + plan cap enforced (max_agency_bots)
  // - Private bots: any active member (not capped here)
  // - Owner/admin do NOT count toward seat limits (handled elsewhere)
  try {
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
    await ensureOnboardingColumns(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
    const maxAgencyBots = pickMaxAgencyBotsFromLimits(limits);

    const ownerUserId = scope === "private" ? ctx.userId : null;

    // Create vector store OUTSIDE any DB locking.
    // If we fail to insert (cap exceeded / DB error), we best-effort delete it.
    const vs = await openai.vectorStores.create({ name });

    try {
      const id = crypto.randomUUID();

      if (scope === "agency" && maxAgencyBots != null) {
        // Atomic cap enforcement in ONE statement
        const info = await db.run(
          `INSERT INTO bots (id, agency_id, name, owner_user_id, vector_store_id, created_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE (
             SELECT COUNT(1)
             FROM bots
             WHERE agency_id = ? AND owner_user_id IS NULL
           ) < ?`,
          id,
          ctx.agencyId,
          name,
          null,
          vs.id,
          new Date().toISOString(),
          ctx.agencyId,
          maxAgencyBots
        );

        const affected = getRowsAffected(info);
        if (affected === 0) {
          try {
            await openai.vectorStores.delete(vs.id);
          } catch {}

          return NextResponse.json(
            {
              ok: false,
              error: "BOT_LIMIT_EXCEEDED",
              code: "BOT_LIMIT_EXCEEDED",
              plan,
              limit: maxAgencyBots,
            },
            { status: 403 }
          );
        }

        await markCreatedFirstBot(db, ctx.userId);

        return NextResponse.json({
          ok: true,
          bot: {
            id,
            name,
            scope: "agency",
            owner_user_id: null,
            vector_store_id: vs.id,
          },
        });
      }

      // Private bot (no cap here)
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

      await markCreatedFirstBot(db, ctx.userId);

      return NextResponse.json({
        ok: true,
        bot: {
          id,
          name,
          scope: "private",
          owner_user_id: ownerUserId,
          vector_store_id: vs.id,
        },
      });
    } catch (e) {
      try {
        await openai.vectorStores.delete(vs.id);
      } catch {}
      throw e;
    }
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