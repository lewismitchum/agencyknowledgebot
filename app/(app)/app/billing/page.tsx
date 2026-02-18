"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

function BillingStatusBanner() {
  const sp = useSearchParams();

  const banner = useMemo(() => {
    const status = sp.get("status");
    const canceled = sp.get("canceled");
    const success = sp.get("success");

    // Support a few common patterns: ?success=1, ?canceled=1, ?status=success|canceled
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
  const plans = [
    {
      key: "free",
      name: "Free",
      price: "$0",
      badge: "Current default",
      bullets: [
        "1 agency bot",
        "5 daily uploads (docs only)",
        "Daily chat limits",
        "No schedule/to-do/calendar",
      ],
      cta: { label: "Go to Chat", href: "/chat", variant: "secondary" as const },
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
      cta: { label: "Upgrade (soon)", href: "/billing", variant: "default" as const },
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
      cta: { label: "Upgrade (soon)", href: "/billing", variant: "default" as const },
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
      cta: { label: "Contact us", href: "/docs", variant: "secondary" as const },
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
      cta: { label: "Contact us", href: "/docs", variant: "secondary" as const },
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Upgrade your agency plan. Owner/admin seats don’t count toward limits, and upgrades apply to the whole agency.
        </p>
      </div>

      <Suspense fallback={null}>
        <BillingStatusBanner />
      </Suspense>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">How billing works</CardTitle>
          <CardDescription>
            Plan enforcement is server-side. This page is the UI for upgrades and status.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Louis.Ai is a multi-tenant agency knowledge system: agency bots/docs are shared across the agency; private bots/docs are isolated per user.
          </p>
          <p>
            Schedule/to-do/calendar extraction is a paid feature. Basic reminders/notifications UI can exist on all tiers.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => (
          <Card key={p.key}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">{p.name}</CardTitle>
                  <CardDescription className="mt-1">{p.price}</CardDescription>
                </div>
                <Badge variant="secondary">{p.badge}</Badge>
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
                <Button asChild variant={p.cta.variant}>
                  <Link href={p.cta.href}>{p.cta.label}</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/docs">Plan details</Link>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Note: checkout + webhook wiring will update <code>agencies.plan</code>.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 text-sm text-muted-foreground">
        <p>
          If you’re seeing build failures mentioning <code>useSearchParams()</code>, it means it was used outside of a Suspense boundary.
          This page is structured so <code>useSearchParams()</code> only runs inside a Suspense-wrapped child.
        </p>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return <BillingContent />;
}
