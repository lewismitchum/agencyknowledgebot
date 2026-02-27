"use client";

import { useEffect, useState } from "react";

type Event = {
  id: string;
  title: string;
  start_time: string;
};

type Task = {
  id: string;
  title: string;
  due_date: string;
};

type Extraction = {
  id: string;
  document_id: string;
  created_at: string;
};

export default function NotificationsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-6">Loading...</div>;

  if (!data.scheduleEnabled) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Notifications</h1>
        <div className="border rounded-lg p-6 bg-muted">
          <p className="mb-4">
            Upgrade your plan to unlock schedule and task notifications.
          </p>
          <a
            href="/billing"
            className="inline-block px-4 py-2 bg-black text-white rounded"
          >
            Upgrade Plan
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Notifications</h1>

      <section>
        <h2 className="text-lg font-medium mb-2">Upcoming Events</h2>
        {data.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events.</p>
        ) : (
          <ul className="space-y-2">
            {data.events.map((e: Event) => (
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
        {data.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="space-y-2">
            {data.tasks.map((t: Task) => (
              <li key={t.id} className="border rounded p-3">
                <div className="font-medium">{t.title}</div>
                {t.due_date && (
                  <div className="text-sm text-muted-foreground">
                    Due {new Date(t.due_date).toLocaleDateString()}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Recent Extractions</h2>
        {data.extractions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent extractions.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.extractions.map((x: Extraction) => (
              <li key={x.id} className="border rounded p-3">
                <div className="text-sm">
                  Extraction from document {x.document_id}
                </div>
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