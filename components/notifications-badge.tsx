// components/notifications-badge.tsx
"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

export default function NotificationsBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const j = await fetchJson<any>("/api/notifications/list?limit=20", {
          credentials: "include",
          cache: "no-store",
        });

        const list = Array.isArray(j?.notifications) ? j.notifications : [];
        const unread = list.filter((n: any) => !n?.read_at).length;

        if (!cancelled) setCount(unread);
      } catch {
        // silent
      }
    }

    load();
    const id = setInterval(load, 60000); // refresh every 60s

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!count) return null;

  return (
    <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold text-background">
      {count > 99 ? "99+" : count}
    </span>
  );
}