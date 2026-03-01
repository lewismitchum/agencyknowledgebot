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

// Allowed plan keys you support
const ALLOWED: PlanKey[] = ["free", "starter", "pro", "enterprise", "corporation"];

function isProdEnvironment() {
  // On Vercel, NODE_ENV is "production" for BOTH preview + production.
  // VERCEL_ENV distinguishes: "development" | "preview" | "production"
  const ve = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  return ve === "production";
}

function isAllowedUser(ctx: any) {
  // Support either env var name (UI vs server)
  const allowUserId = String(
    process.env.TIER_SWITCHER_USER_ID ||
      process.env.NEXT_PUBLIC_TIER_SWITCHER_USER_ID ||
      ""
  ).trim();

  if (!allowUserId) return false;
  return String(ctx?.userId || "").trim() === allowUserId;
}

export async function POST(req: NextRequest) {
  // 🔒 Hard lock: dev-only route must not exist in real production.
  // Return 404 (not 403) to avoid advertising the endpoint.
  if (isProdEnvironment()) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const ctx = await requireOwner(req);

    // 🔒 You-only lock (even in preview/dev)
    if (!isAllowedUser(ctx)) {
      return new Response("Not Found", { status: 404 });
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
      vercel_env: process.env.VERCEL_ENV ?? null,
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ error: "Owner only" }, { status: 403 });
    }

    console.error("DEV_SET_PLAN_ERROR", err);
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}