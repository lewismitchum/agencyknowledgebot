import { openai } from "@/lib/openai";
import type { Db } from "@/lib/db";

function nowIso() {
  return new Date().toISOString();
}

function compact(s: string | null | undefined) {
  return String(s ?? "").trim();
}

function extractSection(text: string, heading: string) {
  const safe = compact(text);
  if (!safe) return "";

  const headings = ["FACTS:", "PREFERENCES:", "WORKFLOWS:", "ACTIVE CONTEXT:", "REMOVE/IGNORE:"];
  const start = safe.indexOf(heading);
  if (start === -1) return "";

  const afterStart = start + heading.length;
  let end = safe.length;

  for (const h of headings) {
    if (h === heading) continue;
    const idx = safe.indexOf(h, afterStart);
    if (idx !== -1 && idx < end) end = idx;
  }

  return safe.slice(afterStart, end).trim();
}

function capText(text: string, maxLen: number) {
  const s = compact(text);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen).trim();
}

async function rewriteDecayedMemory(args: {
  scope: "agency" | "user";
  currentMemory: string;
  daysSinceUpdated: number;
  maxLen?: number;
}) {
  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `
You are compacting and decaying a rolling memory string for Louis.Ai.

Goal:
- Keep ONE clean memory string.
- Remove stale, low-value, outdated, superseded, or one-off details.
- Keep durable facts, repeated preferences, recurring workflows, and active context.
- Rewrite the same memory instead of appending duplicates.

Scope:
${args.scope.toUpperCase()}

Age signal:
This memory has not been meaningfully refreshed for ${Math.max(0, Math.floor(args.daysSinceUpdated))} day(s).

Decay behavior:
- Strongly keep durable preferences, stable business facts, and repeated workflows.
- Remove stale blockers, outdated experiments, temporary chatter, and old one-off details.
- If ACTIVE CONTEXT is no longer clearly active, shrink it aggressively.
- Keep REMOVE/IGNORE minimal.
- Never invent facts.

Output rules:
- Plain text only.
- No JSON.
- Use exactly these headings:
FACTS:
PREFERENCES:
WORKFLOWS:
ACTIVE CONTEXT:
REMOVE/IGNORE:

CURRENT MEMORY:
${compact(args.currentMemory) || "(empty)"}
`.trim(),
  });

  const text = compact(resp.output_text);
  return capText(text, args.maxLen ?? 5000);
}

export async function decayMemoryRow(db: Db, args: {
  rowId: string;
  scope: "agency" | "user";
  content: string;
  lastUpdatedAt?: string | null;
  staleAfterDays?: number;
  maxLen?: number;
}) {
  const current = compact(args.content);
  if (!current) return current;

  const staleAfterDays = Math.max(1, Number(args.staleAfterDays ?? 14));
  const maxLen = Math.max(1000, Number(args.maxLen ?? 5000));

  const lastUpdatedMs = args.lastUpdatedAt ? new Date(args.lastUpdatedAt).getTime() : NaN;
  const ageMs = Number.isFinite(lastUpdatedMs) ? Date.now() - lastUpdatedMs : staleAfterDays * 86400000;
  const daysSinceUpdated = Math.max(0, Math.floor(ageMs / 86400000));

  let next = current;

  const tooLong = current.length > maxLen;
  const stale = daysSinceUpdated >= staleAfterDays;

  if (!stale && !tooLong) {
    return current;
  }

  try {
    next = await rewriteDecayedMemory({
      scope: args.scope,
      currentMemory: current,
      daysSinceUpdated,
      maxLen,
    });
  } catch {
    next = current;
  }

  next = capText(next, maxLen);

  await db.run(
    `UPDATE memory_store
     SET content = ?, last_updated_at = ?
     WHERE id = ?`,
    next,
    nowIso(),
    args.rowId
  );

  return next;
}

export async function decayScopeMemories(db: Db, args: {
  agencyId: string;
  userId: string;
  botId: string;
  agencyStaleAfterDays?: number;
  userStaleAfterDays?: number;
  agencyMaxLen?: number;
  userMaxLen?: number;
}) {
  const rows = (await db.all(
    `SELECT id, scope, content, last_updated_at
     FROM memory_store
     WHERE
       (scope = 'agency' AND agency_id = ?)
       OR
       (scope = 'user' AND agency_id = ? AND user_id = ? AND bot_id = ?)`,
    args.agencyId,
    args.agencyId,
    args.userId,
    args.botId
  )) as Array<{
    id?: string;
    scope?: string;
    content?: string | null;
    last_updated_at?: string | null;
  }>;

  for (const row of rows) {
    const scope = row.scope === "agency" ? "agency" : row.scope === "user" ? "user" : null;
    if (!scope || !row.id) continue;

    await decayMemoryRow(db, {
      rowId: String(row.id),
      scope,
      content: String(row.content ?? ""),
      lastUpdatedAt: row.last_updated_at ?? null,
      staleAfterDays: scope === "agency" ? args.agencyStaleAfterDays ?? 21 : args.userStaleAfterDays ?? 14,
      maxLen: scope === "agency" ? args.agencyMaxLen ?? 5500 : args.userMaxLen ?? 4500,
    });
  }
}

export function pruneMemorySections(raw: string, maxLen = 5000) {
  const text = compact(raw);
  if (!text) return "";

  const facts = extractSection(text, "FACTS:");
  const preferences = extractSection(text, "PREFERENCES:");
  const workflows = extractSection(text, "WORKFLOWS:");
  const active = extractSection(text, "ACTIVE CONTEXT:");
  const removeIgnore = extractSection(text, "REMOVE/IGNORE:");

  const rebuilt = [
    "FACTS:",
    facts || "- none",
    "",
    "PREFERENCES:",
    preferences || "- none",
    "",
    "WORKFLOWS:",
    workflows || "- none",
    "",
    "ACTIVE CONTEXT:",
    active || "- none",
    "",
    "REMOVE/IGNORE:",
    removeIgnore || "- none",
  ].join("\n");

  return capText(rebuilt, maxLen);
}