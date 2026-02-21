// app/(app)/app/billing/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type PlanKey = "free" | "starter" | "pro" | "enterprise" | "corporation";

type MeResponse =
  | {
      ok: true;
      agency: {
        id: string;
        name: string | null;
        email: string | null;
        plan: string;
        stripe_current_period_end?: string | null;
        stripe_customer_id?: string | null;
      };
      user: {
        id: string;
        email: string;
        role: string;
        status: string;
        email_verified: number;
      };
    }
  | { ok?: false; error?: string; message?: string };

function BillingStatusBanner() {
  const sp = useSearchParams();

  const banner = useMemo(() => {
    const status = sp.get("status");
    const canceled = sp.get("canceled");
    const success = sp.get("success");

    if (success === "1" || status === "success") {
      return {
        variant: "success" as const,
        title: "Payment successful",
        description: "Your plan will update shortly. You can refresh in a moment.",
      };
    }

    if (canceled === "1" || status === "canceled") {
      return {
        variant: "warning" as const,
        title: "Checkout canceled",
        description: "No worries — you can try again anytime.",
      };
    }

    return null;
  }, [sp]);

  if (!banner) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{banner.title}</CardTitle>
          <Badge variant={banner.variant === "success" ? "default" : "secondary"}>
            {banner.variant === "success" ? "Success" : "Canceled"}
          </Badge>
        </div>
        <CardDescription>{banner.description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function BillingContent() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false);

  const [isOwner, setIsOwner] = useState(false);
  const [devPlan, setDevPlan] = useState<PlanKey>("free");
  const [devSaving, setDevSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/me", { method: "GET", cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as MeResponse;

        if (cancelled) return;

        if ((data as any)?.ok && (data as any)?.agency) {
          const a = (data as any).agency;
          const u = (data as any).user;

          if (a?.plan) {
            const p = String(a.plan);
            setCurrentPlan(p);
            // keep dev dropdown in sync
            if (["free", "starter", "pro", "enterprise", "corporation"].includes(p)) {
              setDevPlan(p as PlanKey);
            }
          }

          if (typeof a?.stripe_current_period_end === "string") setPeriodEnd(a.stripe_current_period_end);
          if (a?.stripe_customer_id) setHasStripeCustomer(true);

          setIsOwner(String(u?.role || "") === "owner");
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout(plan: "starter" | "pro" | "enterprise" | "corporation") {
    try {
      setLoadingPlan(plan);

      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.url) {
        const msg = String(data?.error || data?.message || "Checkout failed");
        alert(msg);
        return;
      }

      window.location.href = String(data.url);
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setLoadingPlan(null);
    }
  }

  async function openPortal() {
    try {
      setPortalLoading(true);

      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.url) {
        const msg = String(data?.error || data?.message || "Could not open billing portal");
        alert(msg);
        return;
      }

      window.location.href = String(data.url);
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setPortalLoading(false);
    }
  }

  async function setPlanForAgency(plan: PlanKey) {
    try {
      setDevSaving(true);
      setDevPlan(plan);

      const res = await fetch("/api/billing/dev-set-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const msg = String(data?.error || data?.message || "Failed to set plan");
        alert(msg);
        return;
      }

      setCurrentPlan(plan);
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setDevSaving(false);
    }
  }

  const plans = [
    {
      key: "free",
      name: "Free",
      price: "$0",
      badge: "Default",
      bullets: ["1 agency bot", "5 daily uploads (docs only)", "Daily chat limits", "No schedule/to-do/calendar"],
      cta: { label: "Go to Chat", href: "/app/chat", variant: "secondary" as const },
    },
    {
      key: "starter",
      name: "Starter",
      price: "$79–$99/mo",
      badge: "Schedule enabled",
      bullets: [
        "1 agency bot",
        "Up to 5 users (owner/admin excluded from seats)",
        "Higher daily chat limits",
        "Unlimited uploads (docs only)",
        "Schedule/to-do/calendar enabled",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("starter"),
    },
    {
      key: "pro",
      name: "Pro",
      price: "$249–$399/mo",
      badge: "Multimedia",
      bullets: [
        "3 agency bots",
        "Up to 15 users (owner/admin excluded from seats)",
        "Unlimited daily chats",
        "Unlimited uploads (docs + images + video)",
        "Schedule/to-do/calendar enabled",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("pro"),
    },
    {
      key: "enterprise",
      name: "Enterprise",
      price: "$899–$999/mo",
      badge: "Teams",
      bullets: [
        "5 agency bots",
        "Up to 50 users (owner/admin excluded from seats)",
        "Unlimited daily chats",
        "Uploads (docs + images + video)",
        "Schedule/to-do/calendar enabled",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("enterprise"),
    },
    {
      key: "corporation",
      name: "Corporation",
      price: "$1799–$1999/mo",
      badge: "Email + AI triage",
      bullets: [
        "10 agency bots",
        "Up to 100 users (owner/admin excluded from seats)",
        "Unlimited daily chats",
        "Uploads (docs + images + video)",
        "Schedule/to-do/calendar enabled",
        "Email page enabled (Gmail-like)",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("corporation"),
    },
  ] as const;

  const isPaid = currentPlan && currentPlan !== "free";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Billing</h1>
            <p className="text-muted-foreground mt-1">
              Upgrade your agency plan. Owner/admin seats don’t count toward limits, and upgrades apply to the whole agency.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary">Current: {currentPlan ? currentPlan : "…"}</Badge>

            <Button
              variant="outline"
              onClick={openPortal}
              disabled={!hasStripeCustomer || !isPaid || portalLoading}
              title={!hasStripeCustomer ? "No Stripe customer yet" : !isPaid ? "Upgrade first" : "Manage subscription"}
            >
              {portalLoading ? "Opening…" : "Manage"}
            </Button>
          </div>
        </div>

        {periodEnd ? (
          <p className="text-xs text-muted-foreground mt-2">
            Renews: <span className="font-mono">{periodEnd}</span>
          </p>
        ) : null}
      </div>

      <Suspense fallback={null}>
        <BillingStatusBanner />
      </Suspense>

      {isOwner ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Owner-only tier switcher</CardTitle>
            <CardDescription>
              This updates <code>agencies.plan</code> for your current agency only (manual override).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Useful for testing paid gates without Stripe.
            </div>

            <div className="flex items-center gap-2">
              <select
                value={devPlan}
                onChange={(e) => setPlanForAgency(e.target.value as PlanKey)}
                disabled={devSaving}
                className="rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="free">free</option>
                <option value="starter">starter</option>
                <option value="pro">pro</option>
                <option value="enterprise">enterprise</option>
                <option value="corporation">corporation</option>
              </select>

              <Badge variant="secondary">{devSaving ? "Saving…" : "Ready"}</Badge>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">How billing works</CardTitle>
          <CardDescription>Plan enforcement is server-side. This page is the UI for upgrades and status.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Louis.Ai is a multi-tenant agency knowledge system: agency bots/docs are shared across the agency; private bots/docs are isolated per user.
          </p>
          <p>Schedule/to-do/calendar extraction is a paid feature. Basic reminders/notifications UI can exist on all tiers.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => {
          const isCurrent = currentPlan && currentPlan === p.key;
          const isPaidCheckout =
            p.key === "starter" || p.key === "pro" || p.key === "enterprise" || p.key === "corporation";

          return (
            <Card key={p.key} className={isCurrent ? "ring-1 ring-border" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <CardDescription className="mt-1">{p.price}</CardDescription>
                  </div>
                  <Badge variant="secondary">{isCurrent ? "Current plan" : (p as any).badge}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Separator />
                <ul className="text-sm text-muted-foreground space-y-2">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="mt-1">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2 flex items-center gap-2">
                  {isPaidCheckout ? (
                    <Button
                      variant={(p as any).cta.variant}
                      onClick={(p as any).onClick}
                      disabled={isCurrent || loadingPlan === p.key}
                    >
                      {isCurrent ? "Current" : loadingPlan === p.key ? "Redirecting..." : (p as any).cta.label}
                    </Button>
                  ) : (
                    <Button asChild variant={(p as any).cta.variant}>
                      <Link href={(p as any).cta.href}>{(p as any).cta.label}</Link>
                    </Button>
                  )}

                  <Button asChild variant="ghost">
                    <Link href="/app/docs">Plan details</Link>
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Note: checkout + webhook wiring updates <code>agencies.plan</code>.
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return <BillingContent />;
}