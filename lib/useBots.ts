"use client";

import { useEffect, useMemo, useState } from "react";
import { getSelectedBotId, setSelectedBotId } from "@/lib/selectedbot";

export type Bot = {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  vector_store_id: string | null;
  created_at?: string;
};

export function useBots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, _setSelectedBotId] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSelectedBotId();
    if (saved) _setSelectedBotId(saved);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      try {
        const res = await fetch("/api/bots", { cache: "no-store" });
        const data = await res.json();
        const list: Bot[] = Array.isArray(data?.bots) ? data.bots : [];

        if (cancelled) return;

        setBots(list);

        // Choose default if none selected or selection no longer exists:
        const saved = getSelectedBotId();
        const exists = saved && list.some(b => b.id === saved);

        if (!exists) {
          // Prefer private bot first, otherwise most recent agency bot
          const preferred = list.find(b => b.owner_user_id) ?? list[0] ?? null;
          _setSelectedBotId(preferred?.id ?? null);
          setSelectedBotId(preferred?.id ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBot = useMemo(
    () => bots.find(b => b.id === selectedBotId) ?? null,
    [bots, selectedBotId]
  );

  function setSelected(id: string) {
    _setSelectedBotId(id);
    setSelectedBotId(id);
  }

  return { bots, loading, selectedBotId, selectedBot, setSelectedBotId: setSelected };
}
