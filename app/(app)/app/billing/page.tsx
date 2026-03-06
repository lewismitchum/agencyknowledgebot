// app/(app)/app/billing/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  FileSpreadsheet,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";

type PlanKey = "free" | "home" | "pro" | "enterprise" | "corporation";

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
        stripe_subscription_id?: string | null;
        stripe_price_id?: string | null;
        trial_used?: number | null;
        trial_days_left?: number | null;
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

function normalizeUiPlan(p: string | null | undefined): PlanKey {
  const s = String(p ?? "").trim().toLowerCase();
  if (!s) return "free";
  if (s === "home") return "home";
  if (s === "personal") return "home";
  if (s === "free") return "free";
  if (s === "pro") return "pro";
  if (s === "enterprise") return "enterprise";
  if (s === "corp") return "corporation";
  if (s === "corporation") return "corporation";
  return "free";
}

function prettyPlan(p: string | null | undefined) {
  const n = normalizeUiPlan(p);
  if (n === "home") return "Home";
  if (n === "corporation") return "Corporation";
  if (n === "enterprise") return "Enterprise";
  if (n === "pro") return "Pro";
  return "Free";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

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
        description: "Your workspace plan should update shortly. If it does not, refresh in a moment.",
      };
    }

    if (canceled === "1" || status === "canceled") {
      return {
        variant: "warning" as const,
        title: "Checkout canceled",
        description: "No charge was made. You can upgrade again whenever you’re ready.",
      };
    }

    return null;
  }, [sp]);

  if (!banner) return null;

  return (
    <Card className="overflow-hidden rounded-[28px] border shadow-sm">
      <CardContent className="p-0">
        <div
          className={[
            "border-b px-6 py-4",
            banner.variant === "success"
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100"
              : "bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100",
          ].join(" ")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{banner.title}</div>
              <div className="mt-1 text-sm opacity-90">{banner.description}</div>
            </div>

            <Badge
              variant={banner.variant === "success" ? "default" : "secondary"}
              className="rounded-full"
            >
              {banner.variant === "success" ? "Success" : "Canceled"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TopStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border bg-background/80 p-5 shadow-sm transition hover:-translate-y-[2px] hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
          <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
        </div>

        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-muted/30 text-muted-foreground shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
}

function FeatureLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm text-muted-foreground">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </li>
  );
}

function PlanHighlight({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success";
}) {
  return (
    <div
      className={[
        "rounded-2xl border px-4 py-3",
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-100"
          : "bg-background/70",
      ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function BillingContent() {
  const sp = useSearchParams();

  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const [currentPlan, setCurrentPlan] = useState<PlanKey>("free");
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false);

  const [stripeSubscriptionId, setStripeSubscriptionId] = useState<string | null>(null);
  const [trialUsed, setTrialUsed] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);

  const [isOwner, setIsOwner] = useState(false);
  const [meUserId, setMeUserId] = useState<string>("");

  const [devPlan, setDevPlan] = useState<PlanKey>("free");
  const [devSaving, setDevSaving] = useState(false);

  const successParam = sp.get("success");
  const statusParam = sp.get("status");
  const isSuccess = successParam === "1" || statusParam === "success";

  const allowedUserId = (process.env.NEXT_PUBLIC_TIER_SWITCHER_USER_ID || "").trim();

  async function loadMeOnce(signal?: AbortSignal) {
    try {
      const data = await fetchJson<MeResponse>("/api/me", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        signal,
      });

      if ((data as any)?.ok && (data as any)?.agency) {
        const a = (data as any).agency;
        const u = (data as any).user;

        const uid = String(u?.id ?? "");
        setMeUserId(uid);

        const planUi = normalizeUiPlan(a?.plan);
        setCurrentPlan(planUi);
        setDevPlan(planUi);

        if (typeof a?.stripe_current_period_end === "string") {
          setPeriodEnd(a.stripe_current_period_end);
        } else {
          setPeriodEnd(null);
        }

        setHasStripeCustomer(Boolean(a?.stripe_customer_id));

        setStripeSubscriptionId(
          typeof a?.stripe_subscription_id === "string" ? a.stripe_subscription_id : null
        );

        const tu = Number((a as any)?.trial_used ?? 0) === 1;
        setTrialUsed(tu);

        const tdl = (a as any)?.trial_days_left;
        if (tdl === null || typeof tdl === "undefined") {
          setTrialDaysLeft(null);
        } else {
          const n = Number(tdl);
          setTrialDaysLeft(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null);
        }

        setIsOwner(String(u?.role || "") === "owner");
      }

      return data;
    } catch (e: any) {
      if (e instanceof FetchJsonError && e.info.status === 401) {
        window.location.href = "/login";
        return {} as any;
      }
      return {} as any;
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    loadMeOnce(ac.signal).catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isSuccess) return;

    let stopped = false;
    const ac = new AbortController();

    const startedAt = Date.now();
    const maxMs = 20_000;
    const everyMs = 2_000;

    async function tick() {
      if (stopped) return;

      try {
        const data = await loadMeOnce(ac.signal);
        const plan = normalizeUiPlan((data as any)?.agency?.plan);
        if (plan && plan !== "free") {
          stopped = true;
          return;
        }
      } catch {}

      if (Date.now() - startedAt >= maxMs) {
        stopped = true;
        return;
      }

      setTimeout(tick, everyMs);
    }

    tick();

    return () => {
      stopped = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  async function startCheckout(plan: "home" | "pro" | "enterprise" | "corporation") {
    try {
      setLoadingPlan(plan);

      const data = await fetchJson<any>("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan }),
      });

      const url = String(data?.url || "");
      if (!url) {
        const msg = String(data?.error || data?.message || "Checkout failed");
        alert(msg);
        return;
      }

      window.location.href = url;
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }
        alert(String(e.info.bodyText || `Checkout failed (${e.info.status})`));
        return;
      }
      alert(String(e?.message ?? e));
    } finally {
      setLoadingPlan(null);
    }
  }

  async function openPortal() {
    try {
      setPortalLoading(true);

      const data = await fetchJson<any>("/api/billing/portal", {
        method: "POST",
        credentials: "include",
      });

      const url = String(data?.url || "");
      if (!url) {
        const msg = String(data?.error || data?.message || "Could not open billing portal");
        alert(msg);
        return;
      }

      window.location.href = url;
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }
        alert(String(e.info.bodyText || `Could not open billing portal (${e.info.status})`));
        return;
      }
      alert(String(e?.message ?? e));
    } finally {
      setPortalLoading(false);
    }
  }

  async function setPlanForAgency(plan: PlanKey) {
    try {
      setDevSaving(true);
      setDevPlan(plan);

      const data = await fetchJson<any>("/api/billing/dev-set-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan }),
      });

      if (!data?.ok) {
        const msg = String(data?.error || data?.message || "Failed to set plan");
        alert(msg);
        return;
      }

      setCurrentPlan(plan);
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }
        alert(String(e.info.bodyText || `Failed to set plan (${e.info.status})`));
        return;
      }
      alert(String(e?.message ?? e));
    } finally {
      setDevSaving(false);
    }
  }

  const plans = [
    {
      key: "free" as const,
      name: "Free",
      price: "$0",
      badge: "Default",
      icon: <ShieldCheck className="h-5 w-5" />,
      bullets: ["1 shared bot", "5 uploads/day (docs only)", "20 chats/day", "No schedule or extraction"],
      cta: { label: "Go to Chat", href: "/app/chat", variant: "secondary" as const },
      accent:
        "border-border bg-card/75",
    },
    {
      key: "home" as const,
      name: "Home",
      price: "$89/mo",
      badge: "Best starting point",
      icon: <Sparkles className="h-5 w-5" />,
      bullets: [
        "1 shared bot",
        "Up to 5 members (owner/admin excluded from seats)",
        "100 chats/day",
        "Unlimited uploads (docs only)",
        "Schedule + to-do + calendar extraction enabled",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("home"),
      accent:
        "border-primary/20 bg-[radial-gradient(700px_220px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),linear-gradient(to_bottom,hsl(var(--background)),hsl(var(--background)))]",
    },
    {
      key: "pro" as const,
      name: "Pro",
      price: "$349/mo",
      badge: "Multimedia",
      icon: <Building2 className="h-5 w-5" />,
      bullets: [
        "3 shared bots",
        "Up to 15 members (owner/admin excluded from seats)",
        "Unlimited chats",
        "Unlimited uploads (docs + images + video)",
        "Schedule + extraction enabled",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("pro"),
      accent: "border-border bg-card/75",
    },
    {
      key: "enterprise" as const,
      name: "Enterprise",
      price: "$999/mo",
      badge: "Teams",
      icon: <CreditCard className="h-5 w-5" />,
      bullets: [
        "5 shared bots",
        "Up to 50 members (owner/admin excluded from seats)",
        "Unlimited chats",
        "Uploads (docs + images + video)",
        "Schedule + extraction enabled",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("enterprise"),
      accent: "border-border bg-card/75",
    },
    {
      key: "corporation" as const,
      name: "Corporation",
      price: "$1899/mo",
      badge: "Email + spreadsheets",
      icon: <Mail className="h-5 w-5" />,
      bullets: [
        "10 shared bots",
        "Up to 100 members (owner/admin excluded from seats)",
        "Unlimited chats",
        "Uploads (docs + images + video)",
        "Schedule + extraction enabled",
        "Email page enabled (Gmail-like)",
        "Spreadsheet AI enabled",
      ],
      cta: { label: "Upgrade", variant: "default" as const },
      onClick: () => startCheckout("corporation"),
      accent: "border-border bg-card/75",
    },
  ] as const;

  const isPaid = currentPlan !== "free";
  const trialEligible = !trialUsed && !stripeSubscriptionId;
  const showDevSwitcher = !!allowedUserId && !!meUserId && allowedUserId === meUserId && isOwner;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <section className="relative overflow-hidden rounded-[32px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.10),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Workspace billing
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
              Upgrade the whole workspace, not just one seat.
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Louis.Ai plans apply to your entire agency. Upgrade once to unlock more bots, more
              uploads, schedule workflows, multimedia, email, and spreadsheet AI for the workspace.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PlanHighlight label="Current plan" value={prettyPlan(currentPlan)} />
              <PlanHighlight
                label="Subscription"
                value={isPaid ? "Active" : "Free workspace"}
                tone={isPaid ? "success" : "default"}
              />
              <PlanHighlight
                label="Trial"
                value={
                  trialDaysLeft != null
                    ? trialDaysLeft > 0
                      ? `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
                      : "Ended"
                    : trialEligible
                    ? "Available"
                    : "Already used"
                }
              />
              <PlanHighlight
                label="Renewal"
                value={formatDateTime(periodEnd) || "Not scheduled"}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {trialEligible ? (
                <Badge variant="secondary" className="rounded-full px-3 py-1">
                  7-day free trial available
                </Badge>
              ) : null}
              {hasStripeCustomer ? (
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  Stripe customer linked
                </Badge>
              ) : (
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  No Stripe customer yet
                </Badge>
              )}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[280px]">
            <Button
              variant="outline"
              onClick={openPortal}
              disabled={!hasStripeCustomer || !isPaid || portalLoading}
              title={!hasStripeCustomer ? "No Stripe customer yet" : !isPaid ? "Upgrade first" : "Manage subscription"}
              className="h-11 rounded-2xl"
            >
              {portalLoading ? "Opening..." : "Manage subscription"}
            </Button>

            <Button asChild variant="outline" className="h-11 rounded-2xl">
              <Link href="/pricing">
                Full pricing details
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TopStat
          icon={<ShieldCheck className="h-5 w-5" />}
          label="Current plan"
          value={prettyPlan(currentPlan)}
          hint="Applied to the full workspace"
        />
        <TopStat
          icon={<CreditCard className="h-5 w-5" />}
          label="Subscription"
          value={isPaid ? "Active" : "Free"}
          hint={hasStripeCustomer ? "Stripe customer linked" : "No Stripe customer yet"}
        />
        <TopStat
          icon={<Mail className="h-5 w-5" />}
          label="Email"
          value={currentPlan === "corporation" ? "On" : "Off"}
          hint="Corp-only inbox features"
        />
        <TopStat
          icon={<FileSpreadsheet className="h-5 w-5" />}
          label="Sheets"
          value={currentPlan === "corporation" ? "On" : currentPlan !== "free" ? "Planned" : "Off"}
          hint="Spreadsheet AI on paid tiers"
        />
      </div>

      <Suspense fallback={null}>
        <BillingStatusBanner />
      </Suspense>

      {showDevSwitcher ? (
        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base tracking-tight">Owner-only tier switcher</CardTitle>
            <CardDescription>
              This updates <code>agencies.plan</code> for your current workspace only.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Useful for testing paid gates without running Stripe checkout.
            </div>

            <div className="flex items-center gap-2">
              <select
                value={devPlan}
                onChange={(e) => setPlanForAgency(e.target.value as PlanKey)}
                disabled={devSaving}
                className="rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="free">free</option>
                <option value="home">home</option>
                <option value="pro">pro</option>
                <option value="enterprise">enterprise</option>
                <option value="corporation">corporation</option>
              </select>

              <Badge variant="secondary" className="rounded-full">
                {devSaving ? "Saving..." : "Ready"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">How workspace billing works</CardTitle>
            <CardDescription className="mt-2">
              One owner upgrade updates the agency plan for everyone in the workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-3xl border bg-muted/25 p-4">
              Louis.Ai is billed at the workspace level. Shared bots and docs belong to the
              agency, while private bots and docs stay isolated per user.
            </div>

            <div className="rounded-3xl border bg-muted/25 p-4">
              Schedule, to-do, and calendar extraction are paid features. Corporation also
              unlocks email and spreadsheet AI workflows.
            </div>

            <div className="rounded-3xl border bg-muted/25 p-4">
              {trialEligible
                ? "If you upgrade now, your first subscription starts with a 7-day free trial. Trials are one-time per workspace."
                : "Trials are one-time per workspace. If your workspace already used a trial or subscription, checkout begins billing immediately."}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">Best for right now</CardTitle>
            <CardDescription className="mt-2">
              Most agencies should start with Home, then move up when they need more bots or
              multimedia.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Home</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Best fit for smaller agencies that want shared planning, extraction, and day-to-day
                team use.
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Pro</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Better when you need multiple shared bots, more members, and multimedia uploads.
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Corporation</div>
              <div className="mt-1 text-sm text-muted-foreground">
                For agencies that want the full operating system: email workflows, spreadsheets,
                and maximum scale.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {plans.map((p) => {
          const isCurrent = currentPlan === p.key;
          const isPaidCheckout = p.key !== "free";
          const highlighted = p.key === "home";

          return (
            <Card
              key={p.key}
              className={[
                "relative overflow-hidden rounded-[28px] border shadow-sm transition-all duration-200 hover:-translate-y-[2px] hover:shadow-md",
                p.accent,
                isCurrent ? "ring-1 ring-border" : "",
                highlighted ? "xl:scale-[1.01]" : "",
              ].join(" ")}
            >
              {highlighted ? (
                <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--accent)))]" />
              ) : null}

              <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl tracking-tight">{p.name}</CardTitle>
                    <CardDescription className="mt-1 text-base">{p.price}</CardDescription>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground shadow-sm">
                      {p.icon}
                    </div>
                    <Badge variant={isCurrent ? "default" : "secondary"} className="rounded-full">
                      {isCurrent ? "Current plan" : p.badge}
                    </Badge>
                  </div>
                </div>

                {isPaidCheckout && trialEligible && !isCurrent ? (
                  <Badge variant="outline" className="w-fit rounded-full">
                    Includes 7-day free trial
                  </Badge>
                ) : null}
              </CardHeader>

              <CardContent className="space-y-4">
                <Separator />

                <ul className="space-y-2">
                  {p.bullets.map((b) => (
                    <FeatureLine key={b}>{b}</FeatureLine>
                  ))}
                </ul>

                <div className="flex items-center gap-2 pt-2">
                  {p.key === "free" ? (
                    <Button asChild variant={p.cta.variant} className="rounded-2xl">
                      <Link href={p.cta.href}>{p.cta.label}</Link>
                    </Button>
                  ) : (
                    <Button
                      variant={p.cta.variant}
                      onClick={p.onClick}
                      disabled={isCurrent || loadingPlan === p.key}
                      className="rounded-2xl"
                    >
                      {isCurrent ? "Current" : loadingPlan === p.key ? "Redirecting..." : p.cta.label}
                    </Button>
                  )}

                  <Button asChild variant="ghost" className="rounded-2xl">
                    <Link href="/pricing">Details</Link>
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Plan updates are enforced server-side after checkout and webhook processing.
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
  return (
    <Suspense fallback={null}>
      <BillingContent />
    </Suspense>
  );
}