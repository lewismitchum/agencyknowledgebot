import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2026-01-28.clover" });
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

  if (priceId && priceId === starter) return "starter";
  if (priceId && priceId === pro) return "pro";
  if (priceId && priceId === ent) return "enterprise";
  return "free";
}

async function setAgencyPlan(db: Db, agencyId: string, plan: PlanKey) {
  await db.run(`UPDATE agencies SET plan = ? WHERE id = ?`, plan, agencyId);
}

export async function POST(req: NextRequest) {
  try {
    const stripe = getStripe();
    const secret = getWebhookSecret();

    const sig = req.headers.get("stripe-signature");
    if (!sig) return NextResponse.json({ ok: false, error: "MISSING_SIGNATURE" }, { status: 400 });

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

    // 1) Checkout completed: trust metadata.plan (what user selected)
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const agencyId = String((session.metadata as any)?.agency_id || session.client_reference_id || "").trim();
      const plan = normalizePlan((session.metadata as any)?.plan);

      if (agencyId && plan !== "free") {
        await setAgencyPlan(db, agencyId, plan);
      }

      return NextResponse.json({ ok: true });
    }

    // 2) Subscription updated/created: derive plan from active price id (more authoritative over time)
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;

      const agencyId = String((sub.metadata as any)?.agency_id || "").trim();

      const firstItem = sub.items?.data?.[0];
      const priceId = firstItem?.price?.id || null;

      const plan = planFromPriceId(priceId);

      if (agencyId) {
        // If subscription canceled/unpaid, Stripe may still send updated events; keep it simple for v1:
        // active/trialing => mapped plan, else => free
        const status = String(sub.status || "");
        const active = status === "active" || status === "trialing";
        await setAgencyPlan(db, agencyId, active ? plan : "free");
      }

      return NextResponse.json({ ok: true });
    }

    // 3) Subscription deleted => downgrade
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const agencyId = String((sub.metadata as any)?.agency_id || "").trim();
      if (agencyId) {
        await setAgencyPlan(db, agencyId, "free");
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("STRIPE_WEBHOOK_ERROR", err);
    // Stripe expects 2xx to avoid retries unless we truly want retries.
    return NextResponse.json({ ok: true, warning: "webhook_error_logged" }, { status: 200 });
  }
}
