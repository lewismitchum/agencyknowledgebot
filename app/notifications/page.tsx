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
  events: Event[];
  tasks: Task[];
  extractions: Extraction[];
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGated(false);
      setError("");

      try {
        const j = await fetchJson<any>("/api/notifications", {
          credentials: "include",
          cache: "no-store",
        });

        const payload: NotificationsPayload = {
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
          if (e.status === 403) {
            setGated(true);
            setLoading(false);
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

  if (gated) {
    return (
      <UpgradeGate
        title="Notifications are a paid feature"
        message="Upgrade your plan to unlock schedule and task notifications."
        ctaHref="/app/settings/billing"
        ctaLabel="Upgrade Plan"
      />
    );
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Notifications</h1>
        <div className="border rounded-lg p-4 bg-red-50 text-red-700 text-sm">{error}</div>
      </div>
    );
  }

  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];
  const extractions = data?.extractions ?? [];

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Notifications</h1>

      <section>
        <h2 className="text-lg font-medium mb-2">Upcoming Events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="border rounded p-3">
                <div className="font-medium">{e.title}</div>
                <div className="text-sm text-muted-foreground">
                  {new Date(e.start_time).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Open Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className="border rounded p-3">
                <div className="font-medium">{t.title}</div>
                {t.due_date ? (
                  <div className="text-sm text-muted-foreground">
                    Due {new Date(t.due_date).toLocaleDateString()}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Recent Extractions</h2>
        {extractions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent extractions.</p>
        ) : (
          <ul className="space-y-2">
            {extractions.map((x) => (
              <li key={x.id} className="border rounded p-3">
                <div className="text-sm">Extraction from document {x.document_id}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(x.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}