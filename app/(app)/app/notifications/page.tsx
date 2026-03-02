// app/(app)/app/notifications/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type NotificationRow = {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  created_at: string;
  read_at: string | null;
};

type ListPayload = {
  ok?: boolean;
  plan?: string;
  upsell?: Upsell | null;
  notifications: NotificationRow[];
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function NotificationsPage() {
  const [data, setData] = useState<ListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [marking, setMarking] = useState<string | null>(null);
  const [markError, setMarkError] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const j = await fetchJson<any>("/api/notifications/list?limit=80", {
        credentials: "include",
        cache: "no-store",
      });

      const payload: ListPayload = {
        ok: Boolean(j?.ok ?? true),
        plan: typeof j?.plan === "string" ? j.plan : undefined,
        upsell: j?.upsell ?? null,
        notifications: Array.isArray(j?.notifications) ? (j.notifications as NotificationRow[]) : [],
      };

      setData(payload);
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setError(e?.message ?? "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upsell = data?.upsell ?? null;
  const notifications = data?.notifications ?? [];

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read_at).length, [notifications]);

  async function markRead(id: string) {
    const nid = String(id || "").trim();
    if (!nid) return;

    setMarkError("");
    setMarking(nid);

    try {
      const j = await fetchJson<any>("/api/notifications/read", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: nid }),
      });

      if (!j?.ok) {
        setMarkError("Failed to mark as read.");
        return;
      }

      // optimistic update
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        next.notifications = (next.notifications || []).map((n) =>
          n.id === nid ? { ...n, read_at: n.read_at || new Date().toISOString() } : n
        );
        return next;
      });
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setMarkError(e?.message ?? "Failed to mark as read");
    } finally {
      setMarking(null);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (error) {
    return (
      <div className="p-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-muted" onClick={() => load().catch(() => {})}>
            Reload
          </button>
        </div>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {upsell?.code ? "Upgrade to unlock schedule notifications." : `Unread: ${unreadCount}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/app/schedule" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Schedule
          </Link>
          <Link href="/app/docs" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Docs
          </Link>
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-muted" onClick={() => load().catch(() => {})}>
            Reload
          </button>
        </div>
      </div>

      {upsell?.code ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-medium">Upgrade to unlock notifications</div>
          <div className="mt-1 text-amber-800">{upsell.message || "Upgrade your plan to unlock notifications."}</div>
          <div className="mt-3">
            <Link href="/app/billing" className="rounded-md bg-amber-700 px-3 py-2 text-sm text-white hover:opacity-90">
              Upgrade Plan
            </Link>
          </div>
        </div>
      ) : null}

      {markError ? <div className="rounded-lg border bg-red-50 p-3 text-sm text-red-700">{markError}</div> : null}

      {notifications.length === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">No notifications yet.</div>
      ) : (
        <div className="space-y-2">
          {notifications.slice(0, 80).map((n) => {
            const unread = !n.read_at;
            return (
              <div
                key={n.id}
                className={cx(
                  "rounded-2xl border bg-card p-4",
                  unread ? "border-primary/40 bg-primary/5" : "border-border"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{n.title || "Notification"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(n.created_at)}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    {n.url ? (
                      <Link href={n.url} className="rounded-md border px-3 py-2 text-xs hover:bg-muted">
                        Open
                      </Link>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => markRead(n.id).catch(() => {})}
                      disabled={!unread || marking === n.id}
                      className="rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                      title={unread ? "Mark as read" : "Read"}
                    >
                      {marking === n.id ? "Marking…" : unread ? "Mark read" : "Read"}
                    </button>
                  </div>
                </div>

                {n.body ? <div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{n.body}</div> : null}

                {n.type ? <div className="mt-3 text-[11px] font-mono text-muted-foreground">{n.type}</div> : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Cron: call <span className="font-mono">/api/cron/reminders</span> every 5 minutes with your cron secret.
      </div>
    </div>
  );
}