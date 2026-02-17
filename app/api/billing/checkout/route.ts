// app/api/billing/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, type Db } from "@/lib/db";
import { requireOwner } from "@/lib/authz";
import { getAppUrl } from "@/lib/email";

export const runtime = "nodejs";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

async function ensureBillingColumns(db: Db) {
  // Best-effort schema patching (no migrations required).
  await db.run("ALTER TABLE agencies ADD COLUMN stripe_customer_id TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN stripe_subscription_id TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN stripe_price_id TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN billing_status TEXT").catch(() => {});
}

function priceIdForPlan(plan: string) {
  const p = String(plan || "").toLowerCase();
  if (p === "starter") return process.env.STRIPE_PRICE_STARTER || "";
  if (p === "pro") return process.env.STRIPE_PRICE_PRO || "";
  if (p === "enterprise") return process.env.STRIPE_PRICE_ENTERPRISE || "";
  if (p === "corporation") return process.env.STRIPE_PRICE_CORPORATION || "";
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);
    const body = await req.json().catch(() => ({}));
    const plan = String(body?.plan || "").trim().toLowerCase();

    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      return NextResponse.json({ ok: false, error: "Invalid plan or missing Stripe price id" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureBillingColumns(db);

    const agency = (await db.get(
      `SELECT id, email, stripe_customer_id
       FROM agencies
       WHERE id = ? LIMIT 1`,
      ctx.agencyId
    )) as { id: string; email: string | null; stripe_customer_id: string | null } | undefined;

    if (!agency?.id) return NextResponse.json({ ok: false, error: "Agency not found" }, { status: 404 });

    const stripe = stripeClient();

    // Create customer once (optional but useful)
    let customerId = agency.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: ctx.agencyEmail || agency.email || undefined,
        metadata: { agency_id: ctx.agencyId },
      });
      customerId = customer.id;
      await db.run(
        `UPDATE agencies SET stripe_customer_id = ? WHERE id = ?`,
        customerId,
        ctx.agencyId
      );
    }

    const appUrl = getAppUrl(); // you already have this helper
    const success_url = `${appUrl}/app/billing?success=1`;
    const cancel_url = `${appUrl}/app/billing?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,
      metadata: {
        agency_id: ctx.agencyId,
        plan_requested: plan,
      },
    });

    // Optional: store last requested price id
    await db.run(
      `UPDATE agencies SET stripe_price_id = ? WHERE id = ?`,
      priceId,
      ctx.agencyId
    );

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.json({ error: "Pending approval" }, { status: 403 });
    if (msg === "FORBIDDEN_NOT_OWNER") return NextResponse.json({ error: "Owner only" }, { status: 403 });
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
