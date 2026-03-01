// app/api/billing/dev-set-plan/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireOwner } from "@/lib/authz";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";

type Body = {
  plan?: string;
};

const ALLOWED: PlanKey[] = ["free", "starter", "pro", "enterprise", "corporation"];

function getCtxUserId(ctx: any): string {
  return String(
    ctx?.userId ??
      ctx?.user_id ??
      ctx?.user?.id ??
      ctx?.user?.userId ??
      ctx?.id ??
      ""
  ).trim();
}

function getAllowedUserId(): string {
  return String(
    process.env.TIER_SWITCHER_USER_ID ||
      process.env.NEXT_PUBLIC_TIER_SWITCHER_USER_ID ||
      ""
  ).trim();
}

function isProdVercel() {
  const ve = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  return ve === "production";
}

function allowInProdBypass(): boolean {
  // Explicit, opt-in bypass for production only (still locked to allowed user).
  // Set this in Vercel ONLY if you want dev-set-plan on production.
  return String(process.env.ALLOW_DEV_SET_PLAN_IN_PROD || "").trim() === "1";
}

function notFound() {
  return new Response("Not Found", { status: 404 });
}

export async function POST(req: NextRequest) {
  // 🔒 Default: dev-only route must not exist in real production.
  // But allow an explicit bypass env var if you want it.
  if (isProdVercel() && !allowInProdBypass()) {
    return notFound();
  }

  try {
    const ctx = await requireOwner(req);

    const ctxUserId = getCtxUserId(ctx);
    const allowedUserId = getAllowedUserId();

    // 🔒 You-only lock (stealth)
    if (!allowedUserId || !ctxUserId || ctxUserId !== allowedUserId) {
      return notFound();
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => ({}))) as Body;
    const desired = normalizePlan(body?.plan);

    if (!ALLOWED.includes(desired)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PLAN", allowed: ALLOWED },
        { status: 400 }
      );
    }

    await db.run(`UPDATE agencies SET plan = ? WHERE id = ?`, desired, ctx.agencyId);

    return NextResponse.json({
      ok: true,
      agency_id: ctx.agencyId,
      plan: desired,
      debug: {
        vercel_env: process.env.VERCEL_ENV ?? null,
        node_env: process.env.NODE_ENV ?? null,
        prod_bypass: allowInProdBypass(),
        allowed_user_id_set: Boolean(allowedUserId),
        ctx_user_id_present: Boolean(ctxUserId),
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_OWNER") return NextResponse.json({ error: "Owner only" }, { status: 403 });

    console.error("DEV_SET_PLAN_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}