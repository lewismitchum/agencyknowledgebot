// app/(app)/app/notifications/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

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
        // Fire-and-forget tick (creates notifications rows, throttled server-side)
        // Ignore errors so the page still loads.
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

        if (isFetchJsonError(e)) {
          if (e.status === 401) {
            window.location.href = "/login";
            return;
          }
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

  if (loading) return <div className="p-6">Loading...</div>;

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Notifications</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  const upsell = data?.upsell ?? null;
  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];
  const extractions = data?.extractions ?? [];

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">Upcoming events, open tasks, and recent extractions.</p>
        </div>

        <div className="flex gap-2">
          <Link href="/app/schedule" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Schedule
          </Link>
          <Link href="/app/docs" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Docs
          </Link>
        </div>
      </div>

      {upsell?.code ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-medium">Upgrade to unlock notifications</div>
          <div className="mt-1 text-amber-800">
            {upsell.message || "Upgrade your plan to unlock schedule + task notifications."}
          </div>
          <div className="mt-3">
            <Link href="/app/billing" className="rounded-md bg-amber-700 px-3 py-2 text-sm text-white hover:opacity-90">
              Upgrade Plan
            </Link>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-medium">Upcoming Events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded border p-3">
                <div className="font-medium">{e.title}</div>
                <div className="text-sm text-muted-foreground">{fmtDateTime(e.start_time)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Open Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className="rounded border p-3">
                <div className="font-medium">{t.title}</div>
                {t.due_date ? (
                  <div className="text-sm text-muted-foreground">Due {fmtDate(t.due_date)}</div>
                ) : (
                  <div className="text-sm text-muted-foreground">No due date</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Recent Extractions</h2>
        {extractions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent extractions.</p>
        ) : (
          <ul className="space-y-2">
            {extractions.map((x) => (
              <li key={x.id} className="rounded border p-3">
                <div className="text-sm">Extraction from document {x.document_id}</div>
                <div className="text-xs text-muted-foreground">{fmtDateTime(x.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}