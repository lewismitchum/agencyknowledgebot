// app/api/billing/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key);
}

function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  return secret;
}

function planFromPriceId(priceId: string | null | undefined): PlanKey {
  const starter = process.env.STRIPE_PRICE_STARTER || "";
  const pro = process.env.STRIPE_PRICE_PRO || "";
  const ent = process.env.STRIPE_PRICE_ENTERPRISE || "";
  const corp = process.env.STRIPE_PRICE_CORPORATION || "";

  if (priceId && priceId === corp) return "corporation";
  if (priceId && priceId === ent) return "enterprise";
  if (priceId && priceId === pro) return "pro";
  if (priceId && priceId === starter) return "starter";
  return "free";
}

function pickBestPlan(plans: PlanKey[]): PlanKey {
  const rank: Record<PlanKey, number> = {
    free: 0,
    starter: 1,
    pro: 2,
    enterprise: 3,
    corporation: 4,
  };
  let best: PlanKey = "free";
  for (const p of plans) {
    if (rank[p] > rank[best]) best = p;
  }
  return best;
}

function agencyIdFromCheckoutSession(session: Stripe.Checkout.Session): string {
  const meta = (session.metadata || {}) as Record<string, string>;
  const fromMeta = String(meta.agency_id || "").trim();
  const fromRef = String(session.client_reference_id || "").trim();
  return fromMeta || fromRef || "";
}

function agencyIdFromSubscription(sub: Stripe.Subscription): string {
  const meta = (sub.metadata || {}) as Record<string, string>;
  return String(meta.agency_id || "").trim();
}

function toIsoFromUnixSeconds(sec: number | null | undefined) {
  if (!sec || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000).toISOString();
}

async function updateAgencyBilling(
  db: Db,
  agencyId: string,
  patch: {
    plan?: PlanKey;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    stripe_price_id?: string | null;
    stripe_current_period_end?: string | null;
  }
) {
  const fields: string[] = [];
  const args: any[] = [];

  if (typeof patch.plan !== "undefined") {
    fields.push("plan = ?");
    args.push(patch.plan);
  }
  if (typeof patch.stripe_customer_id !== "undefined") {
    fields.push("stripe_customer_id = ?");
    args.push(patch.stripe_customer_id);
  }
  if (typeof patch.stripe_subscription_id !== "undefined") {
    fields.push("stripe_subscription_id = ?");
    args.push(patch.stripe_subscription_id);
  }
  if (typeof patch.stripe_price_id !== "undefined") {
    fields.push("stripe_price_id = ?");
    args.push(patch.stripe_price_id);
  }
  if (typeof patch.stripe_current_period_end !== "undefined") {
    fields.push("stripe_current_period_end = ?");
    args.push(patch.stripe_current_period_end);
  }

  if (!fields.length) return;

  args.push(agencyId);

  await db.run(`UPDATE agencies SET ${fields.join(", ")} WHERE id = ?`, ...args);
}

export async function POST(req: NextRequest) {
  try {
    const stripe = getStripe();
    const secret = getWebhookSecret();

    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ ok: false, error: "MISSING_SIGNATURE" }, { status: 400 });
    }

    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (e: any) {
      console.error("STRIPE_WEBHOOK_SIGNATURE_INVALID", e?.message ?? e);
      return NextResponse.json({ ok: false, error: "INVALID_SIGNATURE" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    // 1) Checkout completed: initial plan selection (metadata.plan) + customer/subscription ids
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const agencyId = agencyIdFromCheckoutSession(session);
      const desired = normalizePlan(((session.metadata || {}) as any)?.plan);

      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : (session.customer as any)?.id
            ? String((session.customer as any).id)
            : null;

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription as any)?.id
            ? String((session.subscription as any).id)
            : null;

      if (agencyId) {
        await updateAgencyBilling(db, agencyId, {
          plan: desired !== "free" ? desired : undefined,
          stripe_customer_id: customerId ?? undefined,
          stripe_subscription_id: subscriptionId ?? undefined,
        });
      }

      return NextResponse.json({ ok: true });
    }

    // 2) Subscription created/updated: authoritative plan + ids + period end
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;

      const agencyId = agencyIdFromSubscription(sub);

      const status = String(sub.status || "");
      const active = status === "active" || status === "trialing";

      const itemPriceIds = (sub.items?.data || []).map((it) => it.price?.id || null).filter(Boolean) as string[];
      const itemPlans: PlanKey[] = itemPriceIds.map((pid) => planFromPriceId(pid));
      const bestPlan = pickBestPlan(itemPlans);

      const chosenPriceId = itemPriceIds.length ? itemPriceIds[0] : null;

      const customerId =
        typeof sub.customer === "string"
          ? sub.customer
          : (sub.customer as any)?.id
            ? String((sub.customer as any).id)
            : null;

      const periodEndIso = toIsoFromUnixSeconds((sub as any).current_period_end);

      if (agencyId) {
        await updateAgencyBilling(db, agencyId, {
          plan: active ? bestPlan : "free",
          stripe_customer_id: customerId ?? undefined,
          stripe_subscription_id: sub.id ?? undefined,
          stripe_price_id: chosenPriceId ?? undefined,
          stripe_current_period_end: periodEndIso ?? undefined,
        });
      }

      return NextResponse.json({ ok: true });
    }

    // 3) Subscription deleted => downgrade + clear subscription fields (keep customer id if present)
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const agencyId = agencyIdFromSubscription(sub);

      const customerId =
        typeof sub.customer === "string"
          ? sub.customer
          : (sub.customer as any)?.id
            ? String((sub.customer as any).id)
            : null;

      if (agencyId) {
        await updateAgencyBilling(db, agencyId, {
          plan: "free",
          stripe_customer_id: customerId ?? undefined,
          stripe_subscription_id: null,
          stripe_price_id: null,
          stripe_current_period_end: null,
        });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("STRIPE_WEBHOOK_ERROR", err);
    // Stripe expects 2xx unless you want retries.
    return NextResponse.json({ ok: true, warning: "webhook_error_logged" }, { status: 200 });
  }
}