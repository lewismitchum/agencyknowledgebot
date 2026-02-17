// lib/fallbackSummary.ts
export type ChatMsg = { role: "user" | "assistant"; content: string };

function clip(s: string, max = 400) {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/**
 * Deterministic, no-LLM summary.
 * Keeps continuity when OpenAI summarization fails (429/402/timeouts/etc).
 */
export function fallbackSummarize(recent: ChatMsg[], priorSummary?: string | null) {
  const user = recent.filter(m => m.role === "user").slice(-8).map(m => m.content);
  const assistant = recent.filter(m => m.role === "assistant").slice(-6).map(m => m.content);

  const parts: string[] = [];

  if (priorSummary?.trim()) {
    parts.push(`Previous summary:\n${clip(priorSummary, 700)}`);
  }

  parts.push(
    `Current thread (fallback):`,
    `User:\n${user.map(t => `- ${clip(t, 180)}`).join("\n") || "- (none)"}`,
    `Assistant:\n${assistant.map(t => `- ${clip(t, 180)}`).join("\n") || "- (none)"}`
  );

  // Hard cap so it never grows
  return clip(parts.join("\n\n"), 1400);
}
