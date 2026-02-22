// app/api/bots/private/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember } from "@/lib/authz";
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

async function ensureUserRow(db: Db, agencyId: string, userId: string, email: string) {
  // best-effort drift patching for legacy columns
  await db.run("ALTER TABLE users ADD COLUMN role TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN status TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN created_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER").catch(() => {});
  await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT").catch(() => {});

  // Create if missing (do NOT overwrite existing)
  const existing = (await db.get(
    `SELECT id FROM users WHERE id = ? AND agency_id = ? LIMIT 1`,
    userId,
    agencyId
  )) as { id: string } | undefined;

  if (existing?.id) return;

  const ts = new Date().toISOString();
  await db.run(
    `INSERT INTO users (id, agency_id, email, role, status, created_at, updated_at, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    agencyId,
    email,
    "member",
    "active",
    ts,
    ts,
    1
  );
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const userId = String((ctx as any)?.userId || "").trim();
    if (!userId) {
      return NextResponse.json({ error: "Server error", message: "Session missing userId" }, { status: 500 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    const bots = await db.all(
      `SELECT id, name, description, owner_user_id, vector_store_id, created_at
       FROM bots
       WHERE agency_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC`,
      ctx.agencyId,
      userId
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

    const userId = String((ctx as any)?.userId || "").trim();
    const userEmail = String((ctx as any)?.userEmail || (ctx as any)?.email || (ctx as any)?.agencyEmail || "").trim();

    if (!userId) {
      return NextResponse.json({ error: "Server error", message: "Session missing userId" }, { status: 500 });
    }
    if (!userEmail) {
      return NextResponse.json({ error: "Server error", message: "Session missing user email" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;

    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const db: Db = await getDb();
    await ensureSchema(db);

    // Make sure user row exists (private bots belong to a real user id)
    await ensureUserRow(db, ctx.agencyId, userId, userEmail.toLowerCase());

    // Optional: enforce private bot cap by plan
    const plan = await getAgencyPlan(db, ctx.agencyId, (ctx as any)?.plan ?? null);
    const limits = getPlanLimits(plan);
    const maxPrivateBots = pickMaxPrivateBotsFromLimits(limits);

    if (maxPrivateBots != null) {
      const row = (await db.get(
        `SELECT COUNT(*) as c
         FROM bots
         WHERE agency_id = ? AND owner_user_id = ?`,
        ctx.agencyId,
        userId
      )) as { c: number } | undefined;

      const current = Number(row?.c ?? 0);
      if (current >= Number(maxPrivateBots)) {
        return NextResponse.json(
          {
            ok: false,
            error: "BOT_LIMIT_EXCEEDED",
            plan,
            kind: "private_bot",
            used: current,
            limit: Number(maxPrivateBots),
          },
          { status: 403 }
        );
      }
    }

    const vs = await tryCreateVectorStore(`Louis.Ai • Private Bot • ${name} • ${ctx.agencyId} • ${userId}`);
    const botId = makeId("bot");

    await db.run(
      `INSERT INTO bots (id, agency_id, owner_user_id, name, description, vector_store_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      botId,
      ctx.agencyId,
      userId,
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
    if (code === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Pending approval" }, { status: 403 });

    console.error("BOTS_PRIVATE_POST_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}