// app/api/billing/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireOwner } from "@/lib/authz";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getOrigin(req: NextRequest) {
  const h = req.headers;
  const fromHeader = h.get("origin") || h.get("x-forwarded-host");
  if (fromHeader) {
    if (fromHeader.startsWith("http")) return fromHeader;
    const proto = h.get("x-forwarded-proto") || "https";
    return `${proto}://${fromHeader}`;
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key);
}

function priceIdForPlan(plan: PlanKey): string | null {
  if (plan === "starter") return process.env.STRIPE_PRICE_STARTER || null;
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO || null;
  if (plan === "enterprise") return process.env.STRIPE_PRICE_ENTERPRISE || null;
  if (plan === "corporation") return process.env.STRIPE_PRICE_CORPORATION || null;
  return null;
}

async function ensureAgencyTrialColumns(db: Db) {
  await db.run(`ALTER TABLE agencies ADD COLUMN trial_used INTEGER`).catch(() => {});
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureAgencyTrialColumns(db);

    const body = await req.json().catch(() => ({}));
    const desired = normalizePlan(body?.plan);

    if (desired === "free") {
      return NextResponse.json({ ok: false, error: "INVALID_PLAN" }, { status: 400 });
    }

    const priceId = priceIdForPlan(desired);
    if (!priceId) {
      return NextResponse.json({ ok: false, error: "MISSING_PRICE_ID", plan: desired }, { status: 500 });
    }

    const agency = (await db.get(
      `SELECT id, email, stripe_customer_id, stripe_subscription_id, trial_used
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as
      | {
          id: string;
          email: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          trial_used: number | null;
        }
      | undefined;

    const origin = getOrigin(req);
    const stripe = getStripe();

    // ✅ Trial rules:
    // - Only apply a 7-day trial if:
    //   - agency.trial_used is not set AND
    //   - agency has no existing subscription id
    const trialEligible =
      Number(agency?.trial_used ?? 0) !== 1 && !String(agency?.stripe_subscription_id ?? "").trim();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: ctx.agencyEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: ctx.agencyId,
      metadata: {
        agency_id: ctx.agencyId,
        plan: desired,
        trial_days: trialEligible ? "7" : "0",
      },
      subscription_data: {
        metadata: {
          agency_id: ctx.agencyId,
          plan: desired,
        },
        ...(trialEligible ? { trial_period_days: 7 } : {}),
      },
      success_url: `${origin}/app/billing?success=1`,
      cancel_url: `${origin}/app/billing?canceled=1`,
    });

    return NextResponse.json({
      ok: true,
      url: session.url,
      trial: trialEligible ? { days: 7 } : { days: 0 },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_OWNER") return NextResponse.json({ error: "Owner only" }, { status: 403 });

    console.error("BILLING_CHECKOUT_ERROR", err);
    return NextResponse.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}