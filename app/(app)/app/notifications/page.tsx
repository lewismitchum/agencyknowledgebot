// app/(app)/app/notifications/page.tsx
"use client";

import { useEffect, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
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

type NotificationsPayload = {
  plan: string;
  schedule_enabled: boolean;
  events: Event[];
  tasks: Task[];
  extractions: Extraction[];
  notices: Array<{ id: string; title: string; body: string }>;
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
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
        const j = await fetchJson<any>("/api/notifications", {
          credentials: "include",
          cache: "no-store",
        });

        const payload: NotificationsPayload = {
          plan: String(j?.plan ?? "free"),
          schedule_enabled: !!j?.schedule_enabled,
          events: Array.isArray(j?.events) ? j.events : [],
          tasks: Array.isArray(j?.tasks) ? j.tasks : [],
          extractions: Array.isArray(j?.extractions) ? j.extractions : [],
          notices: Array.isArray(j?.notices) ? j.notices : [],
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

  if (loading) return <div className="p-6">Loading...</div>;

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Notifications</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  const plan = data?.plan ?? "free";
  const scheduleEnabled = !!data?.schedule_enabled;

  // Notifications are for all tiers, but schedule/task feed is Starter+.
  if (!scheduleEnabled) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Notifications</h1>

        <div className="rounded-2xl border bg-card p-5">
          <div className="text-sm font-medium">You’re on {plan}.</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Schedule, tasks, and extraction notifications unlock on Starter+.
          </div>
          <div className="mt-4">
            <UpgradeGate
              title="Unlock notifications that matter"
              message="Upgrade to get schedule/task reminders and extraction outcomes."
              ctaHref="/app/billing"
              ctaLabel="Upgrade"
            />
          </div>
        </div>

        {(data?.notices ?? []).length > 0 ? (
          <section>
            <h2 className="mb-2 text-lg font-medium">Notices</h2>
            <ul className="space-y-2">
              {(data?.notices ?? []).map((n) => (
                <li key={n.id} className="rounded-lg border p-3">
                  <div className="font-medium">{n.title}</div>
                  <div className="text-sm text-muted-foreground">{n.body}</div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];
  const extractions = data?.extractions ?? [];
  const notices = data?.notices ?? [];

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Notifications</h1>

      {notices.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-medium">Notices</h2>
          <ul className="space-y-2">
            {notices.map((n) => (
              <li key={n.id} className="rounded-lg border p-3">
                <div className="font-medium">{n.title}</div>
                <div className="text-sm text-muted-foreground">{n.body}</div>
              </li>
            ))}
          </ul>
        </section>
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
                <div className="text-sm text-muted-foreground">{new Date(e.start_time).toLocaleString()}</div>
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
                  <div className="text-sm text-muted-foreground">Due {new Date(t.due_date).toLocaleDateString()}</div>
                ) : null}
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
                <div className="text-xs text-muted-foreground">{new Date(x.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}