// app/(app)/app/notifications/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Event = {
  id: string;
  title: string;
  start_time: string;
};

type Task = {
  id: string;
  title: string;
  due_date: string | null;
};

type Extraction = {
  id: string;
  document_id: string;
  created_at: string;
};

type Upsell = {
  code?: string;
  message?: string;
};

type NotificationsPayload = {
  ok?: boolean;
  plan?: string;
  upsell?: Upsell | null;
  events: Event[];
  tasks: Task[];
  extractions: Extraction[];
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function isTodayLike(iso: string | null | undefined) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isOverdue(iso: string | null | undefined) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now() && !isTodayLike(iso);
}

function StatCard(props: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div
      className={[
        "rounded-3xl border p-4",
        props.tone === "danger"
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-100"
          : "bg-background/80",
      ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{props.value}</div>
    </div>
  );
}

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        fetchJson("/api/notifications/tick", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {});

        const j = await fetchJson<any>("/api/notifications", {
          credentials: "include",
          cache: "no-store",
        });

        const payload: NotificationsPayload = {
          ok: Boolean(j?.ok ?? true),
          plan: typeof j?.plan === "string" ? j.plan : undefined,
          upsell: j?.upsell ?? null,
          events: Array.isArray(j?.events) ? j.events : [],
          tasks: Array.isArray(j?.tasks) ? j.tasks : [],
          extractions: Array.isArray(j?.extractions) ? j.extractions : [],
        };

        if (!cancelled) setData(payload);
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load notifications");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const upsell = data?.upsell ?? null;
  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];
  const extractions = data?.extractions ?? [];

  const todayEventsCount = useMemo(
    () => events.filter((e) => isTodayLike(e.start_time)).length,
    [events]
  );

  const overdueTasksCount = useMemo(
    () => tasks.filter((t) => isOverdue(t.due_date)).length,
    [tasks]
  );

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <section className="rounded-[28px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex rounded-full border bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Workspace activity
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Notifications</h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Upcoming events, task reminders, and recent extraction activity.
            </p>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="h-24 animate-pulse rounded-3xl border bg-muted/40" />
            <div className="h-24 animate-pulse rounded-3xl border bg-muted/40" />
            <div className="h-24 animate-pulse rounded-3xl border bg-muted/40" />
            <div className="h-24 animate-pulse rounded-3xl border bg-muted/40" />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="h-80 animate-pulse rounded-[28px] border bg-muted/40" />
          <div className="h-80 animate-pulse rounded-[28px] border bg-muted/40" />
          <div className="h-80 animate-pulse rounded-[28px] border bg-muted/40" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <section className="rounded-[28px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex rounded-full border bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Workspace activity
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Notifications</h1>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">
                Upcoming events, task reminders, and recent extraction activity.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/schedule">Schedule</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/docs">Docs</Link>
              </Button>
            </div>
          </div>
        </section>

        <Card className="overflow-hidden rounded-[28px] border shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-red-50 px-6 py-4 text-red-900 dark:bg-red-950/20 dark:text-red-100">
              <div className="text-sm font-semibold">Could not load notifications</div>
              <div className="mt-1 text-sm opacity-90">{error}</div>
            </div>
            <div className="flex flex-wrap gap-3 p-6">
              <Button className="rounded-full" onClick={() => window.location.reload()}>
                Retry
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/schedule">Open Schedule</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-[28px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex rounded-full border bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Workspace activity
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Notifications</h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Stay on top of upcoming events, open tasks, and recent extraction activity across your workspace.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/schedule">Schedule</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/docs">Docs</Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Plan" value={data?.plan || "Free"} />
          <StatCard label="Upcoming events" value={String(events.length)} />
          <StatCard label="Open tasks" value={String(tasks.length)} tone={overdueTasksCount > 0 ? "danger" : "default"} />
          <StatCard label="Extractions" value={String(extractions.length)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline" className="rounded-full px-3 py-1">
            Today: {todayEventsCount} events
          </Badge>
          <Badge variant={overdueTasksCount > 0 ? "destructive" : "secondary"} className="rounded-full px-3 py-1">
            Overdue tasks: {overdueTasksCount}
          </Badge>
        </div>
      </section>

      {upsell?.code ? (
        <Card className="overflow-hidden rounded-[28px] border border-amber-200 shadow-sm dark:border-amber-900/40">
          <CardContent className="p-0">
            <div className="border-b bg-amber-50 px-6 py-4 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
              <div className="text-sm font-semibold">Upgrade to unlock more notifications</div>
              <div className="mt-1 text-sm opacity-90">
                {upsell.message || "Upgrade your plan to unlock schedule and task notifications."}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 p-6">
              <Button asChild className="rounded-full">
                <Link href="/app/billing">Upgrade plan</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/schedule">Open Schedule</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl tracking-tight">Upcoming events</CardTitle>
                <CardDescription className="mt-2">
                  Meetings and schedule items coming up soon.
                </CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full">
                {events.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <div className="rounded-3xl border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
                No upcoming events.
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-3xl border bg-background p-4 shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{e.title}</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {fmtDateTime(e.start_time)}
                        </div>
                      </div>
                      {isTodayLike(e.start_time) ? (
                        <Badge variant="secondary" className="rounded-full">
                          Today
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl tracking-tight">Open tasks</CardTitle>
                <CardDescription className="mt-2">
                  Tasks that still need attention.
                </CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full">
                {tasks.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <div className="rounded-3xl border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
                No open tasks.
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((t) => {
                  const overdue = isOverdue(t.due_date);
                  const dueToday = isTodayLike(t.due_date);

                  return (
                    <div
                      key={t.id}
                      className="rounded-3xl border bg-background p-4 shadow-sm transition hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{t.title}</div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {t.due_date ? `Due ${fmtDate(t.due_date)}` : "No due date"}
                          </div>
                        </div>

                        {overdue ? (
                          <Badge variant="destructive" className="rounded-full">
                            Overdue
                          </Badge>
                        ) : dueToday ? (
                          <Badge variant="secondary" className="rounded-full">
                            Due today
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl tracking-tight">Recent extractions</CardTitle>
                <CardDescription className="mt-2">
                  Latest document processing activity.
                </CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full">
                {extractions.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {extractions.length === 0 ? (
              <div className="rounded-3xl border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
                No recent extractions.
              </div>
            ) : (
              <div className="space-y-3">
                {extractions.map((x) => (
                  <div
                    key={x.id}
                    className="rounded-3xl border bg-background p-4 shadow-sm transition hover:shadow-md"
                  >
                    <div className="text-sm font-semibold">Document extraction</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Document ID: {x.document_id}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtDateTime(x.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}