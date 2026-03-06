// app/(app)/app/usage/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Database,
  HardDrive,
  MessageSquare,
  RefreshCw,
  Users,
  Bot,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type UsageResp = {
  ok: boolean;
  plan?: string;
  limits?: {
    daily_messages?: number | null;
    daily_uploads?: number | null;
    bots_limit?: number | null;
    users_limit?: number | null;
    storage_mb?: number | null;
  };
  usage?: {
    day_key?: string | null;
    messages_used?: number;
    uploads_used?: number;
  };
  remaining?: {
    messages?: number | null;
    uploads?: number | null;
  };
  resets_at?: string | null;
  error?: string;
  message?: string;
};

function fmtLimit(n: number | null | undefined) {
  if (n == null) return "Unlimited";
  if (!Number.isFinite(n)) return "—";
  return String(n);
}

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (!Number.isFinite(n)) return "—";
  return String(n);
}

function prettyPlan(p: string | null | undefined) {
  const v = String(p || "").toLowerCase();
  if (v === "home" || v === "personal") return "Home";
  if (v === "pro") return "Pro";
  if (v === "enterprise") return "Enterprise";
  if (v === "corporation" || v === "corp") return "Corporation";
  return "Free";
}

function percentUsed(used: number, limit: number | null | undefined) {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return 0;
  const pct = Math.round((used / limit) * 100);
  return Math.max(0, Math.min(100, pct));
}

function toneForPercent(pct: number) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-foreground";
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

function UsageBar({
  label,
  used,
  limit,
  remaining,
}: {
  label: string;
  used: number;
  limit: number | null | undefined;
  remaining: number | null | undefined;
}) {
  const pct = percentUsed(used, limit);

  return (
    <div className="rounded-3xl border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {limit == null ? "Unlimited plan" : `${fmtNum(used)} of ${fmtLimit(limit)} used`}
          </div>
        </div>

        <Badge
          variant={pct >= 90 ? "destructive" : pct >= 70 ? "outline" : "secondary"}
          className="rounded-full"
        >
          {limit == null ? "Unlimited" : `${pct}% used`}
        </Badge>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${toneForPercent(pct)}`}
          style={{ width: `${limit == null ? 12 : pct}%` }}
        />
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        Remaining today:{" "}
        <span className="font-medium text-foreground">
          {remaining == null ? "Unlimited" : fmtNum(remaining)}
        </span>
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [data, setData] = useState<UsageResp | null>(null);

  const plan = String(data?.plan ?? "free");

  const msgLimit = data?.limits?.daily_messages ?? null;
  const uplLimit = data?.limits?.daily_uploads ?? null;

  const msgUsed = Number(data?.usage?.messages_used ?? 0);
  const uplUsed = Number(data?.usage?.uploads_used ?? 0);

  const msgRemain =
    data?.remaining?.messages ?? (msgLimit == null ? null : Math.max(0, Number(msgLimit) - msgUsed));
  const uplRemain =
    data?.remaining?.uploads ?? (uplLimit == null ? null : Math.max(0, Number(uplLimit) - uplUsed));

  const msgPct = useMemo(() => percentUsed(msgUsed, msgLimit), [msgUsed, msgLimit]);
  const uplPct = useMemo(() => percentUsed(uplUsed, uplLimit), [uplUsed, uplLimit]);

  const headline = useMemo(() => {
    if (loading) return "Loading usage";
    return `${prettyPlan(plan)} plan usage`;
  }, [loading, plan]);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const r = await fetch("/api/usage", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = (await r.json().catch(() => null)) as UsageResp | null;

      if (!r.ok || !j?.ok) {
        const msg = String((j as any)?.error || (j as any)?.message || `Failed (${r.status})`);
        setError(msg);
        setData(null);
        return;
      }

      setData(j);
    } catch (e: any) {
      setError(e?.message || "Failed to load usage");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <section className="relative overflow-hidden rounded-[32px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.10),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Workspace usage
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">Usage</h1>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Track daily chats, uploads, and plan caps for the whole workspace. Resets are based
              on your workspace timezone.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded-full px-3 py-1">
                {headline}
              </Badge>

              {data?.usage?.day_key ? (
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  Day: {String(data.usage.day_key)}
                </Badge>
              ) : null}

              {data?.resets_at ? (
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  Resets: {String(data.resets_at)}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[260px]">
            <Button variant="outline" className="h-11 rounded-2xl" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing..." : "Refresh"}
            </Button>

            <Button asChild variant="outline" className="h-11 rounded-2xl">
              <Link href="/app/billing">
                Billing
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <Card className="overflow-hidden rounded-[28px] border shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-red-50 px-6 py-4 text-red-900 dark:bg-red-950/20 dark:text-red-100">
              <div className="text-sm font-semibold">Could not load usage</div>
              <div className="mt-1 text-sm opacity-90">{error}</div>
            </div>
            <div className="flex flex-wrap gap-3 p-6">
              <Button className="rounded-full" onClick={load}>
                Retry
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/support">Support</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TopStat
          icon={<MessageSquare className="h-5 w-5" />}
          label="Messages"
          value={loading ? "—" : fmtNum(msgUsed)}
          hint={loading ? "Loading daily usage" : `Limit: ${fmtLimit(msgLimit)}`}
        />
        <TopStat
          icon={<Database className="h-5 w-5" />}
          label="Uploads"
          value={loading ? "—" : fmtNum(uplUsed)}
          hint={loading ? "Loading daily usage" : `Limit: ${fmtLimit(uplLimit)}`}
        />
        <TopStat
          icon={<Bot className="h-5 w-5" />}
          label="Bots cap"
          value={loading ? "—" : fmtLimit(data?.limits?.bots_limit ?? null)}
          hint="Workspace-wide bot limit"
        />
        <TopStat
          icon={<Users className="h-5 w-5" />}
          label="Users cap"
          value={loading ? "—" : fmtLimit(data?.limits?.users_limit ?? null)}
          hint="Owner/admin excluded from seats"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">Today’s usage</CardTitle>
            <CardDescription className="mt-2">
              Daily limits apply to chats and uploads. Higher plans unlock higher or unlimited caps.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <UsageBar
              label="Messages"
              used={msgUsed}
              limit={msgLimit}
              remaining={msgRemain}
            />

            <UsageBar
              label="Uploads"
              used={uplUsed}
              limit={uplLimit}
              remaining={uplRemain}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border bg-muted/25 p-4">
                <div className="text-sm font-semibold">Remaining today</div>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <div>
                    Messages:{" "}
                    <span className="font-medium text-foreground">
                      {msgRemain == null ? "Unlimited" : fmtNum(msgRemain)}
                    </span>
                  </div>
                  <div>
                    Uploads:{" "}
                    <span className="font-medium text-foreground">
                      {uplRemain == null ? "Unlimited" : fmtNum(uplRemain)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border bg-muted/25 p-4">
                <div className="text-sm font-semibold">Usage health</div>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <div>
                    Messages:{" "}
                    <span className="font-medium text-foreground">
                      {msgLimit == null ? "Unlimited" : `${msgPct}% used`}
                    </span>
                  </div>
                  <div>
                    Uploads:{" "}
                    <span className="font-medium text-foreground">
                      {uplLimit == null ? "Unlimited" : `${uplPct}% used`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">Plan caps</CardTitle>
            <CardDescription className="mt-2">
              Workspace-level limits currently active for this plan.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Bots</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Shared bot capacity for this workspace.
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {fmtLimit(data?.limits?.bots_limit ?? null)}
                </Badge>
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Users</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Seat limit for members on the workspace plan.
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {fmtLimit(data?.limits?.users_limit ?? null)}
                </Badge>
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Storage</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    File storage allowance for your current plan.
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {data?.limits?.storage_mb != null ? `${fmtNum(data.limits.storage_mb)} MB` : "—"}
                </Badge>
              </div>
            </div>

            <Separator />

            <div className="rounded-3xl border bg-muted/25 p-4">
              <div className="text-sm font-semibold">Need more room?</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Upgrade to raise daily limits, increase workspace caps, and unlock more of the full
                Louis.Ai operating system.
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild className="rounded-full">
                  <Link href="/app/billing">Upgrade</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/app/docs">Docs</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/app/support">Support</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[28px] border shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">What resets daily</CardTitle>
          <CardDescription className="mt-2">
            Daily counters refresh automatically based on your workspace day key.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border bg-muted/25 p-4">
            <div className="text-sm font-semibold">Messages</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Chat usage is counted per day and compared against your plan’s daily message limit.
            </div>
          </div>

          <div className="rounded-3xl border bg-muted/25 p-4">
            <div className="text-sm font-semibold">Uploads</div>
            <div className="mt-2 text-sm text-muted-foreground">
              File uploads reset daily unless your plan provides unlimited uploads.
            </div>
          </div>

          <div className="rounded-3xl border bg-muted/25 p-4">
            <div className="text-sm font-semibold">Plan enforcement</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Bots, seats, and paid features are enforced server-side across the workspace.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}