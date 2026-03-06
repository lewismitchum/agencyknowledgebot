// app/api/billing/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { normalizePlan, type PlanKey } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function ensureAgencyBillingColumns(db: Db) {
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_customer_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_subscription_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_price_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN stripe_current_period_end TEXT`).catch(() => {});
  await db.run(`ALTER TABLE agencies ADD COLUMN trial_used INTEGER`).catch(() => {});
}

async function ensureStripeEventsTable(db: Db) {
  await db
    .run(
      `CREATE TABLE IF NOT EXISTS stripe_events (
        id TEXT PRIMARY KEY,
        type TEXT,
        created_at TEXT
      )`
    )
    .catch(() => {});
}

/**
 * Notifications: drift-safe.
 * We create a basic table if missing, then only insert columns that actually exist.
 */
async function ensureNotificationsTable(db: Db) {
  await db
    .run(
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        agency_id TEXT,
        user_id TEXT,
        kind TEXT,
        title TEXT,
        body TEXT,
        href TEXT,
        created_at TEXT,
        read_at TEXT
      )`
    )
    .catch(() => {});
}

async function getTableColumns(db: Db, table: string): Promise<Set<string>> {
  try {
    const rows = (await db.all(`PRAGMA table_info(${table})`)) as Array<{ name?: string }>;
    const s = new Set<string>();
    for (const r of rows) {
      const n = String(r?.name ?? "").trim();
      if (n) s.add(n);
    }
    return s;
  } catch {
    return new Set<string>();
  }
}

async function insertNotificationDriftSafe(
  db: Db,
  args: {
    agencyId: string;
    userId: string;
    kind?: string;
    title: string;
    body: string;
    href?: string;
  }
) {
  const cols = await getTableColumns(db, "notifications");
  if (!cols.size) return;

  const payload: Record<string, any> = {
    id: makeId("notif"),
    agency_id: args.agencyId,
    user_id: args.userId,
    kind: args.kind ?? "system",
    title: args.title,
    body: args.body,
    href: args.href ?? "/app/email",
    created_at: nowIso(),
    read_at: null,
  };

  const keys = Object.keys(payload).filter((k) => cols.has(k));
  if (!keys.length) return;

  const qs = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO notifications (${keys.join(", ")}) VALUES (${qs})`;
  const values = keys.map((k) => payload[k]);

  await db.run(sql, ...values).catch(() => {});
}

async function notifyCorpUpgrade(db: Db, agencyId: string) {
  // Notify active users only (pending users will see it after approval via UI logic anyway)
  const users = (await db.all(
    `SELECT id
     FROM users
     WHERE agency_id = ?
       AND status = 'active'`,
    agencyId
  )) as Array<{ id?: string }>;

  const title = "Email unlocked";
  const body = "Your agency upgraded to Corporation. Connect your inbox to enable the Email page.";

  for (const u of users) {
    const userId = String(u?.id ?? "").trim();
    if (!userId) continue;
    await insertNotificationDriftSafe(db, {
      agencyId,
      userId,
      kind: "billing",
      title,
      body,
      href: "/app/email",
    });
  }
}

function planFromPriceId(priceId: string | null | undefined): PlanKey {
  const home = process.env.STRIPE_PRICE_home || "";
  const pro = process.env.STRIPE_PRICE_PRO || "";
  const ent = process.env.STRIPE_PRICE_ENTERPRISE || "";
  const corp = process.env.STRIPE_PRICE_CORPORATION || "";

  if (priceId && priceId === corp) return "corporation";
  if (priceId && priceId === ent) return "enterprise";
  if (priceId && priceId === pro) return "pro";
  if (priceId && priceId === home) return "home";
  return "free";
}

function pickBestPlan(plans: PlanKey[]): PlanKey {
  const rank: Record<PlanKey, number> = {
    free: 0,
    home: 1,
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

function agencyIdFromInvoice(inv: Stripe.Invoice): string {
  const meta = (inv.metadata || {}) as Record<string, string>;
  return String(meta.agency_id || "").trim();
}

function toIsoFromUnixSeconds(sec: number | null | undefined) {
  if (!sec || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000).toISOString();
}

async function findAgencyIdByStripeIds(db: Db, args: { customerId?: string | null; subscriptionId?: string | null }) {
  const subId = String(args.subscriptionId || "").trim();
  const custId = String(args.customerId || "").trim();

  if (subId) {
    const row = (await db.get(`SELECT id FROM agencies WHERE stripe_subscription_id = ? LIMIT 1`, subId)) as
      | { id?: string }
      | undefined;
    if (row?.id) return String(row.id);
  }

  if (custId) {
    const row = (await db.get(`SELECT id FROM agencies WHERE stripe_customer_id = ? LIMIT 1`, custId)) as
      | { id?: string }
      | undefined;
    if (row?.id) return String(row.id);
  }

  return "";
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
    trial_used?: number | null;
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
  if (typeof patch.trial_used !== "undefined") {
    fields.push("trial_used = ?");
    args.push(patch.trial_used);
  }

  if (!fields.length) return;

  args.push(agencyId);
  await db.run(`UPDATE agencies SET ${fields.join(", ")} WHERE id = ?`, ...args);
}

async function recordStripeEventOnce(db: Db, event: Stripe.Event): Promise<boolean> {
  try {
    await db.run(
      `INSERT INTO stripe_events (id, type, created_at) VALUES (?, ?, ?)`,
      event.id,
      event.type,
      nowIso()
    );
    return true;
  } catch {
    return false;
  }
}

async function withTx<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.run("BEGIN");
  try {
    const out = await fn();
    await db.run("COMMIT");
    return out;
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    throw e;
  }
}

function toInt(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
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
    await ensureAgencyBillingColumns(db);
    await ensureStripeEventsTable(db);
    await ensureNotificationsTable(db);

    const firstTime = await recordStripeEventOnce(db, event);
    if (!firstTime) return NextResponse.json({ ok: true });

    await withTx(db, async () => {
      // ✅ DO NOT set trial_used based on checkout metadata (spoofable).
      // Only set trial_used when Stripe tells us the subscription had/has a trial.

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;

        const agencyId = agencyIdFromCheckoutSession(session);

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
            stripe_customer_id: customerId ?? undefined,
            stripe_subscription_id: subscriptionId ?? undefined,
          });
        }

        return;
      }

      if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
        const sub = event.data.object as Stripe.Subscription;

        let agencyId = agencyIdFromSubscription(sub);

        const status = String(sub.status || "");
        const active = status === "active" || status === "trialing";

        const itemPriceIds = (sub.items?.data || [])
          .map((it) => it.price?.id || null)
          .filter(Boolean) as string[];

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

        if (!agencyId) {
          agencyId = await findAgencyIdByStripeIds(db, { customerId, subscriptionId: sub.id });
        }

        // ✅ One-time trial is considered "used" if Stripe ever reports a trial_end or trialing.
        const trialEndSec = toInt((sub as any).trial_end);
        const trialingNow = status === "trialing";
        const hasEverHadTrial = trialingNow || trialEndSec > 0;

        // Detect plan transition to Corporation (only when active/trialing)
        let priorPlan: PlanKey = "free";
        if (agencyId) {
          const row = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
            | { plan?: string | null }
            | undefined;
          priorPlan = normalizePlan(row?.plan ?? "free");
        }

        if (agencyId) {
          const nextPlan = active ? bestPlan : "free";

          await updateAgencyBilling(db, agencyId, {
            plan: nextPlan,
            stripe_customer_id: customerId ?? undefined,
            stripe_subscription_id: sub.id ?? undefined,
            stripe_price_id: chosenPriceId ?? undefined,
            stripe_current_period_end: periodEndIso ?? undefined,
            ...(hasEverHadTrial ? { trial_used: 1 } : {}),
          });

          // If they just upgraded into Corporation, notify everyone to connect inbox.
          if (active && nextPlan === "corporation" && priorPlan !== "corporation") {
            await notifyCorpUpgrade(db, agencyId);
          }
        }

        return;
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as Stripe.Subscription;

        let agencyId = agencyIdFromSubscription(sub);

        const customerId =
          typeof sub.customer === "string"
            ? sub.customer
            : (sub.customer as any)?.id
              ? String((sub.customer as any).id)
              : null;

        if (!agencyId) {
          agencyId = await findAgencyIdByStripeIds(db, { customerId, subscriptionId: sub.id });
        }

        if (agencyId) {
          await updateAgencyBilling(db, agencyId, {
            plan: "free",
            stripe_customer_id: customerId ?? undefined,
            stripe_subscription_id: null,
            stripe_price_id: null,
            stripe_current_period_end: null,
          });
        }

        return;
      }

      if (event.type === "invoice.payment_failed") {
        const inv = event.data.object as Stripe.Invoice;

        const customerId =
          typeof inv.customer === "string"
            ? inv.customer
            : (inv.customer as any)?.id
              ? String((inv.customer as any).id)
              : null;

        const subscriptionId = (() => {
          const s = (inv as any).subscription;
          if (typeof s === "string") return s;
          if (s && typeof s.id === "string") return String(s.id);
          return null;
        })();

        let agencyId = agencyIdFromInvoice(inv);
        if (!agencyId) {
          agencyId = await findAgencyIdByStripeIds(db, { customerId, subscriptionId });
        }

        if (agencyId) {
          await updateAgencyBilling(db, agencyId, { plan: "free" });
        }

        return;
      }

      if (event.type === "customer.subscription.paused") {
        const sub = event.data.object as Stripe.Subscription;

        let agencyId = agencyIdFromSubscription(sub);

        const customerId =
          typeof sub.customer === "string"
            ? sub.customer
            : (sub.customer as any)?.id
              ? String((sub.customer as any).id)
              : null;

        if (!agencyId) {
          agencyId = await findAgencyIdByStripeIds(db, { customerId, subscriptionId: sub.id });
        }

        if (agencyId) {
          await updateAgencyBilling(db, agencyId, { plan: "free" });
        }

        return;
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("STRIPE_WEBHOOK_ERROR", err);
    // Stripe expects a 2xx to stop retry storms. We log and ack.
    return NextResponse.json({ ok: true, warning: "webhook_error_logged" }, { status: 200 });
  }
}