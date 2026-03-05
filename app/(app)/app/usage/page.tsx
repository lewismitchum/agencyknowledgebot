// app/(app)/app/usage/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

export default function UsagePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [data, setData] = useState<UsageResp | null>(null);

  const plan = String(data?.plan ?? "free");

  const msgLimit = data?.limits?.daily_messages ?? null;
  const uplLimit = data?.limits?.daily_uploads ?? null;

  const msgUsed = Number(data?.usage?.messages_used ?? 0);
  const uplUsed = Number(data?.usage?.uploads_used ?? 0);

  const msgRemain = data?.remaining?.messages ?? (msgLimit == null ? null : Math.max(0, Number(msgLimit) - msgUsed));
  const uplRemain = data?.remaining?.uploads ?? (uplLimit == null ? null : Math.max(0, Number(uplLimit) - uplUsed));

  const headline = useMemo(() => {
    if (loading) return "Loading…";
    return `Plan: ${plan}`;
  }, [loading, plan]);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const r = await fetch("/api/usage", { method: "GET", credentials: "include", cache: "no-store" });

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
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-2 text-muted-foreground">Daily limits and plan caps. Resets are based on workspace timezone.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/app">Back</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{headline}</CardTitle>
          <CardDescription>Messages + uploads are tracked per day key.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full">
              Messages: {loading ? "—" : `${fmtNum(msgUsed)} used`} {loading ? "" : `(limit ${fmtLimit(msgLimit)})`}
            </Badge>
            <Badge variant="secondary" className="rounded-full">
              Uploads: {loading ? "—" : `${fmtNum(uplUsed)} used`} {loading ? "" : `(limit ${fmtLimit(uplLimit)})`}
            </Badge>
            {data?.usage?.day_key ? (
              <Badge variant="outline" className="rounded-full">
                Day: {String(data.usage.day_key)}
              </Badge>
            ) : null}
            {data?.resets_at ? (
              <Badge variant="outline" className="rounded-full">
                Resets: {String(data.resets_at)}
              </Badge>
            ) : null}
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border bg-background/40 p-4">
              <div className="text-sm font-medium">Remaining today</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Messages: <span className="font-medium text-foreground">{msgRemain == null ? "Unlimited" : fmtNum(msgRemain)}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Uploads: <span className="font-medium text-foreground">{uplRemain == null ? "Unlimited" : fmtNum(uplRemain)}</span>
              </div>
            </div>

            <div className="rounded-2xl border bg-background/40 p-4">
              <div className="text-sm font-medium">Plan caps</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Bots: <span className="font-medium text-foreground">{fmtLimit(data?.limits?.bots_limit ?? null)}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Users: <span className="font-medium text-foreground">{fmtLimit(data?.limits?.users_limit ?? null)}</span>
              </div>
              {data?.limits?.storage_mb != null ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  Storage: <span className="font-medium text-foreground">{fmtNum(data.limits.storage_mb)} MB</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
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
        </CardContent>
      </Card>
    </div>
  );
}