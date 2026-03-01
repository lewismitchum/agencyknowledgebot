import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireOwner } from "@/lib/authz";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  plan?: string;
};

// Only allow when explicitly enabled via env var.
// This works on localhost AND Vercel Preview without exposing it in Production.
function devOverrideEnabled() {
  return String(process.env.BILLING_DEV_OVERRIDE_ENABLED || "").trim() === "1";
}

const ALLOWED: PlanKey[] = ["free", "starter", "pro", "enterprise", "corporation"];

export async function POST(req: NextRequest) {
  // 🔒 Hard lock: require explicit enable flag.
  // Return 404 (not 403) to avoid advertising the endpoint.
  if (!devOverrideEnabled()) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const ctx = await requireOwner(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => ({}))) as Body;
    const desired = normalizePlan(body?.plan);

    if (!ALLOWED.includes(desired)) {
      return NextResponse.json({ ok: false, error: "INVALID_PLAN" }, { status: 400 });
    }

    await db.run(`UPDATE agencies SET plan = ? WHERE id = ?`, desired, ctx.agencyId);

    return NextResponse.json({ ok: true, agency_id: ctx.agencyId, plan: desired });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_OWNER") return NextResponse.json({ error: "Owner only" }, { status: 403 });

    console.error("DEV_SET_PLAN_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}