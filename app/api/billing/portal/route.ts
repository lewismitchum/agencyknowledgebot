// app/api/billing/portal/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireOwner } from "@/lib/authz";

export const runtime = "nodejs";

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

async function ensureAgencyBillingColumns(db: Db) {
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_customer_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_subscription_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_price_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_current_period_end TEXT`).catch(() => {});
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureAgencyBillingColumns(db);

    const row = (await db.get(
      `SELECT stripe_customer_id
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { stripe_customer_id?: string | null } | undefined;

    const customerId = String(row?.stripe_customer_id ?? "").trim();
    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "NO_STRIPE_CUSTOMER", message: "No Stripe customer on file yet." },
        { status: 409 }
      );
    }

    const stripe = getStripe();
    const origin = getOrigin(req);

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/app/billing`,
    });

    return NextResponse.json({ ok: true, url: portal.url });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_OWNER") return NextResponse.json({ error: "Owner only" }, { status: 403 });

    console.error("BILLING_PORTAL_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}