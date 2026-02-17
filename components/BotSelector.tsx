"use client";

import React from "react";
import { useBots } from "@/lib/useBots";

export function BotSelector() {
  const { bots, loading, selectedBotId, setSelectedBotId, selectedBot } = useBots();

  if (loading) {
    return (
      <div className="text-sm opacity-70">
        Loading bots…
      </div>
    );
  }

  if (!bots.length) {
    return (
      <div className="text-sm opacity-70">
        No bots found.
      </div>
    );
  }

  return (
    <div className="w-full">
      <label className="block text-sm font-medium mb-1">
        Active bot
      </label>

      <select
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={selectedBotId ?? ""}
        onChange={(e) => setSelectedBotId(e.target.value)}
      >
        {bots.map((b) => {
          const isPrivate = !!b.owner_user_id;
          const prefix = isPrivate ? "Private" : "Agency";
          const label = `${prefix}: ${b.name}`;
          return (
            <option key={b.id} value={b.id}>
              {label}
            </option>
          );
        })}
      </select>

      {selectedBot ? (
        <div className="mt-2 text-xs opacity-70">
          {selectedBot.owner_user_id
            ? "Private bot: only your uploads (once wired) + your memory."
            : "Agency bot: shared team knowledge."}
          {selectedBot.vector_store_id ? "" : " (Vector store not attached yet — chat will safely fallback.)"}
        </div>
      ) : null}
    </div>
  );
}
