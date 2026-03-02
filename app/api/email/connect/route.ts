// app/api/email/connect/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { makeGoogleAuthUrl } from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildState(ctx: { agencyId: string; userId: string }) {
  // Compact, signed-by-secrecy state. (We also store it in httpOnly cookie.)
  return `s_${randomUUID()}_${ctx.agencyId}_${ctx.userId}`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const rawPlan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) {
      return NextResponse.redirect(new URL("/app/billing", req.url));
    }

    const state = buildState({ agencyId: ctx.agencyId, userId: ctx.userId });
    const url = makeGoogleAuthUrl(state);

    if (!url) {
      return NextResponse.json(
        { ok: false, error: "MISSING_GOOGLE_OAUTH_ENV", message: "Missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI" },
        { status: 500 }
      );
    }

    const res = NextResponse.redirect(url);

    // Store state in httpOnly cookie for CSRF protection.
    // short TTL via Max-Age
    res.cookies.set("email_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60, // 10 min
    });

    return res;
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.redirect(new URL("/login", req.url));
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.redirect(new URL("/app", req.url));
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}