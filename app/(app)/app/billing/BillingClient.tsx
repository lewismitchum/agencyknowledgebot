// app/(app)/app/billing/BillingClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type PlanKey = "free" | "starter" | "pro" | "enterprise";

const PLANS: {
  key: PlanKey;
  name: string;
  price: string;
  subtitle: string;
  badge?: string;
  bullets: string[];
  cta: string;
}[] = [
  {
    key: "free",
    name: "Free",
    price: "$0/mo",
    subtitle: "Docs-only • daily limits",
    bullets: ["1 agency bot", "Docs-prioritized answers", "Strict fallback behavior", "Basic daily limit"],
    cta: "Current plan",
  },
  {
    key: "starter",
    name: "Starter",
    price: "$—/mo",
    subtitle: "Higher limits • schedule enabled",
    badge: "Most popular",
    bullets: ["1 agency bot", "More users", "Higher daily usage", "Schedule + extraction (paid)"],
    cta: "Upgrade",
  },
  {
    key: "pro",
    name: "Pro",
    price: "$—/mo",
    subtitle: "More bots • higher limits",
    bullets: ["3 agency bots", "More users", "Higher limits", "Faster indexing"],
    cta: "Upgrade",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Custom",
    subtitle: "Most features • support",
    bullets: ["5 agency bots", "More users", "Highest limits", "Priority support"],
    cta: "Upgrade",
  },
];

function normalizePlan(plan: any): PlanKey {
  const p = String(plan || "").toLowerCase().trim();
  if (p === "starter" || p === "pro" || p === "enterprise") return p;
  return "free";
}

export default function BillingClient() {
  const search = useSearchParams();

  const [plan, setPlan] = useState<PlanKey>("free");
  const [role, setRole] = useState<string>("member");
  const [loading, setLoading] = useState(true);

  const [toast, setToast] = useState<string>("");
  const [busyPlan, setBusyPlan] = useState<PlanKey | null>(null);

  useEffect(() => {
    const success = search.get("success");
    const canceled = search.get("canceled");
    if (success) {
      setToast("Success — your checkout completed. It may take a few seconds for the plan to update.");
      setTimeout(() => setToast(""), 5000);
    } else if (canceled) {
      setToast("Checkout canceled.");
      setTimeout(() => setToast(""), 4000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { credentials: "include" });
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!r.ok) return;

        const j = await r.json().catch(() => null);
        setPlan(normalizePlan(j?.plan));
        setRole(String(j?.user?.role ?? "member"));
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = useMemo(() => PLANS.find((p) => p.key === plan)!, [plan]);

  const isOwner = role === "owner";

  async function startCheckout(target: PlanKey) {
    if (target === "free") return;
    if (!isOwner) {
      setToast("Owner only — ask your agency owner to upgrade.");
      setTimeout(() => setToast(""), 3500);
      return;
    }

    setBusyPlan(target);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: target }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setToast(j?.error || `Checkout failed (${r.status})`);
        setTimeout(() => setToast(""), 4500);
        return;
      }

      const url = String(j?.url || "");
      if (!url) {
        setToast("Checkout failed: missing redirect URL.");
        setTimeout(() => setToast(""), 4500);
        return;
      }

      window.location.href = url;
    } catch (e: any) {
      setToast(e?.message || "Checkout failed.");
      setTimeout(() => setToast(""), 4500);
    } finally {
      setBusyPlan(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
          <p className="mt-2 text-muted-foreground">Upgrade your agency plan. Enforcement is server-side.</p>
        </div>

        <div className="flex gap-2">
          <Link href="/pricing" className="rounded-xl border px-4 py-2 text-sm hover:bg-accent">
            View public pricing
          </Link>
        </div>
      </div>

      {toast ? (
        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Heads up</div>
          <div className="mt-1 text-muted-foreground">{toast}</div>
        </div>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Current plan</CardTitle>
          <CardDescription>What you’re on today.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold">{current.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{current.subtitle}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full">
                  Role: {isOwner ? "owner" : "member"}
                </Badge>
                <Badge variant="outline" className="rounded-full">
                  Plan: {plan}
                </Badge>
              </div>
            </div>
            <div className="text-2xl font-semibold">{current.price}</div>
          </div>

          <Separator className="my-6" />

          <div className="rounded-2xl bg-muted p-4">
            <div className="text-sm font-medium">Docs fallback behavior</div>
            <p className="mt-1 text-sm text-muted-foreground">
              If an answer isn’t present in your uploads, Louis replies exactly:
            </p>
            <div className="mt-3 rounded-xl bg-background p-3 font-mono text-sm">
              I don’t have that information in the docs yet.
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {PLANS.map((p) => {
          const isCurrent = p.key === plan;
          const disabled = loading || isCurrent || (!isOwner && p.key !== "free");
          const busy = busyPlan === p.key;

          return (
            <div key={p.key} className="relative rounded-2xl border bg-card p-5 shadow-sm">
              {p.badge ? (
                <Badge className="absolute -top-3 left-5 rounded-full" variant="secondary">
                  {p.badge}
                </Badge>
              ) : null}

              <div className="text-sm font-semibold">{p.name}</div>
              <div className="mt-2 text-3xl font-semibold">{p.price}</div>
              <div className="mt-2 text-sm text-muted-foreground">{p.subtitle}</div>

              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {p.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <Button
                className="mt-5 w-full rounded-xl"
                variant={isCurrent ? "secondary" : "default"}
                disabled={disabled || busy}
                onClick={!isCurrent && p.key !== "free" ? () => startCheckout(p.key) : undefined}
              >
                {isCurrent ? "Current plan" : busy ? "Redirecting…" : isOwner ? "Upgrade" : "Owner only"}
              </Button>

              {!isOwner && p.key !== "free" ? (
                <p className="mt-3 text-xs text-muted-foreground">Only the agency owner can upgrade.</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
