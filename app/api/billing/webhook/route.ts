// app/api/billing/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, type Db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" as any });
}

async function ensureBillingColumns(db: Db) {
  await db.run("ALTER TABLE agencies ADD COLUMN stripe_customer_id TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN stripe_subscription_id TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN stripe_price_id TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN billing_status TEXT").catch(() => {});
  await db.run("ALTER TABLE agencies ADD COLUMN plan TEXT").catch(() => {}); // in case older DB
}

function planForPriceId(priceId: string | null) {
  const p = String(priceId || "");
  if (!p) return null;

  if (process.env.STRIPE_PRICE_STARTER && p === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (process.env.STRIPE_PRICE_PRO && p === process.env.STRIPE_PRICE_PRO) return "pro";
  if (process.env.STRIPE_PRICE_ENTERPRISE && p === process.env.STRIPE_PRICE_ENTERPRISE) return "enterprise";
  if (process.env.STRIPE_PRICE_CORPORATION && p === process.env.STRIPE_PRICE_CORPORATION) return "corporation";

  return null;
}

async function setAgencyPlan(db: Db, agencyId: string, plan: string, status: string, subId?: string | null, priceId?: string | null) {
  await db.run(
    `UPDATE agencies
     SET plan = ?,
         billing_status = ?,
         stripe_subscription_id = COALESCE(?, stripe_subscription_id),
         stripe_price_id = COALESCE(?, stripe_price_id)
     WHERE id = ?`,
    plan,
    status,
    subId ?? null,
    priceId ?? null,
    agencyId
  );
}

async function downgradeToFree(db: Db, agencyId: string) {
  await db.run(
    `UPDATE agencies
     SET plan = 'free',
         billing_status = 'canceled',
         stripe_subscription_id = NULL,
         stripe_price_id = NULL
     WHERE id = ?`,
    agencyId
  );
}

export async function POST(req: NextRequest) {
  try {
    const stripe = stripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });

    const sig = req.headers.get("stripe-signature");
    if (!sig) return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });

    const rawBody = await req.text();
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err: any) {
      return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureBillingColumns(db);

    // Helper: resolve agency_id from metadata or customer lookup
    const resolveAgencyId = async (maybeAgencyId: string | null, customerId: string | null) => {
      const direct = String(maybeAgencyId || "").trim();
      if (direct) return direct;

      const cust = String(customerId || "").trim();
      if (!cust) return null;

      const row = (await db.get(
        `SELECT id FROM agencies WHERE stripe_customer_id = ? LIMIT 1`,
        cust
      )) as { id: string } | undefined;

      return row?.id ?? null;
    };

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      const agencyId = await resolveAgencyId((session.metadata as any)?.agency_id ?? null, customerId);
      if (!agencyId) return NextResponse.json({ ok: true });

      // Pull subscription to get price id + status
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      if (!subId) return NextResponse.json({ ok: true });

      const sub = await stripe.subscriptions.retrieve(subId);
      const priceId = sub.items.data?.[0]?.price?.id ?? null;
      const plan = planForPriceId(priceId) ?? (String((session.metadata as any)?.plan_requested || "").toLowerCase() || null);

      if (plan) {
        await setAgencyPlan(db, agencyId, plan, String(sub.status || "active"), subId, priceId);
      }

      return NextResponse.json({ ok: true });
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

      // agency_id may exist on subscription metadata if you set it later; we also fall back to customer mapping.
      const agencyId = await resolveAgencyId((sub.metadata as any)?.agency_id ?? null, customerId);
      if (!agencyId) return NextResponse.json({ ok: true });

      const priceId = sub.items.data?.[0]?.price?.id ?? null;
      const plan = planForPriceId(priceId);

      if (sub.status === "canceled" || sub.status === "unpaid" || sub.status === "incomplete_expired") {
        await downgradeToFree(db, agencyId);
        return NextResponse.json({ ok: true });
      }

      if (plan) {
        await setAgencyPlan(db, agencyId, plan, String(sub.status || "active"), sub.id, priceId);
      } else {
        // Unknown price id => don't change plan, but keep status updated
        await db.run(`UPDATE agencies SET billing_status = ? WHERE id = ?`, String(sub.status || "active"), agencyId);
      }

      return NextResponse.json({ ok: true });
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

      const agencyId = await resolveAgencyId((sub.metadata as any)?.agency_id ?? null, customerId);
      if (agencyId) await downgradeToFree(db, agencyId);

      return NextResponse.json({ ok: true });
    }

    // Ignore other events
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
