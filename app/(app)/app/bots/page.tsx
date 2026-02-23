// app/(app)/app/bots/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type BotRow = {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  vector_store_id: string | null;
  created_at: string | null;
  scope?: "agency" | "private";
};

type BotsResponse = {
  ok: boolean;
  bots: Array<{
    id: string;
    name: string;
    scope: "agency" | "private";
    owner_user_id: string | null;
    vector_store_id: string | null;
    created_at: string | null;
  }>;
};

type PlanInfo = {
  plan: string | null;
  limits?: {
    max_agency_bots?: number | null;
    agency_bots?: number | null;
    max_bots?: number | null;
    bots?: number | null;
  };
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function pickMaxAgencyBotsFromAny(limits: any): number | null {
  const raw =
    limits?.max_agency_bots ??
    limits?.agency_bots ??
    limits?.max_bots ??
    limits?.bots ??
    null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function BotsPage() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [scope, setScope] = useState<"agency" | "private">("agency");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");

  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [plan, setPlan] = useState<string | null>(null);
  const [limits, setLimits] = useState<any>(null);
  const [botLimitUsed, setBotLimitUsed] = useState<number>(0);
  const [botLimitMax, setBotLimitMax] = useState<number | null>(null);

  async function loadBots() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/bots", { credentials: "include" });
      const j = (await r.json().catch(() => null)) as BotsResponse | null;

      if (!r.ok) {
        setMsg((j as any)?.error || "Failed to load bots");
        setBots([]);
        return;
      }

      const rows = Array.isArray(j?.bots) ? j!.bots : [];
      const normalized: BotRow[] = rows.map((b) => ({
        id: b.id,
        name: b.name,
        description: null,
        owner_user_id: b.owner_user_id,
        vector_store_id: b.vector_store_id,
        created_at: b.created_at,
        scope: b.scope,
      }));

      setBots(normalized);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load bots");
    } finally {
      setLoading(false);
    }
  }

  async function loadPlanAndLimits() {
    try {
      // We don’t require a specific endpoint contract beyond { plan, limits }.
      // If /api/me already returns plan/limits, we use it.
      const r = await fetch("/api/me", { credentials: "include" });
      const j = (await r.json().catch(() => null)) as any;

      if (!r.ok) return;

      const p = (j?.plan ?? j?.user?.plan ?? j?.agency?.plan ?? null) as string | null;
      const l = (j?.limits ?? j?.agency?.limits ?? j?.plan_limits ?? null) as any;

      setPlan(p ?? null);
      setLimits(l ?? null);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    loadPlanAndLimits();
    loadBots();
  }, []);

  useEffect(() => {
    const used = bots.filter((b) => (b.scope ? b.scope === "agency" : !b.owner_user_id)).length;
    setBotLimitUsed(used);

    const max = pickMaxAgencyBotsFromAny(limits);
    setBotLimitMax(max);
  }, [bots, limits]);

  const defaultBot = useMemo(() => bots.find((b) => (b.scope ? b.scope === "agency" : b.owner_user_id == null)) ?? null, [bots]);

  const agencyBotAtCap = useMemo(() => {
    if (botLimitMax == null) return false;
    return botLimitUsed >= botLimitMax;
  }, [botLimitUsed, botLimitMax]);

  const isError = /fail|error|required|cannot|unauth|forbidden|quota|billing|limit/i.test(msg);

  async function createBot() {
    setMsg("");

    if (!name.trim()) {
      setMsg("Name is required.");
      return;
    }

    if (scope === "agency" && agencyBotAtCap) {
      setMsg(
        botLimitMax == null
          ? "Bot limit reached."
          : `Agency bot limit reached (${botLimitUsed} / ${botLimitMax}). Upgrade in Billing to add more agency bots.`
      );
      return;
    }

    setCreating(true);
    try {
      const r = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          scope,
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        if (j?.error === "BOT_LIMIT_REACHED") {
          const used = Number(j?.bots?.used ?? botLimitUsed);
          const limit = j?.bots?.limit ?? botLimitMax ?? null;
          setMsg(limit == null ? "Agency bot limit reached." : `Agency bot limit reached (${used} / ${limit}). Upgrade in Billing.`);
          await loadPlanAndLimits();
          await loadBots();
          return;
        }

        if (j?.error === "FORBIDDEN_NOT_ADMIN_OR_OWNER" || j?.error === "FORBIDDEN_NOT_OWNER") {
          setMsg("Only owner/admin can create agency bots.");
          return;
        }

        setMsg(j?.error || "Create failed");
        return;
      }

      setMsg("Bot created.");
      setName("");
      setDescription("");
      await loadPlanAndLimits();
      await loadBots();
    } catch (e: any) {
      setMsg(e?.message || "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function repairVectorStore(botId: string) {
    setMsg("");
    setRepairingId(botId);
    try {
      // IMPORTANT: explicit repair path (admin) — no silent auto-fix
      const r = await fetch("/api/admin/fix-vector-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_id: botId }),
      });

      const text = await r.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {}

      if (!r.ok) {
        setMsg(j?.error || j?.message || text || "Repair failed");
        return;
      }

      setMsg("Vector store attached.");
      await loadBots();
    } catch (e: any) {
      setMsg(e?.message || "Repair failed");
    } finally {
      setRepairingId(null);
    }
  }

  async function deleteBot(bot: BotRow) {
    setMsg("");

    // Safe default: only allow deleting private user bots from UI.
    const isPrivate = bot.scope ? bot.scope === "private" : !!bot.owner_user_id;
    if (!isPrivate) {
      setMsg("Agency bots cannot be deleted (yet).");
      return;
    }

    const ok = window.confirm(`Delete "${bot.name}"?\n\nThis will remove the bot and related data. This cannot be undone.`);
    if (!ok) return;

    setDeletingId(bot.id);
    try {
      const r = await fetch(`/api/bots/${bot.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(j?.error || "Delete failed");
        return;
      }

      setMsg("Bot deleted.");
      await loadPlanAndLimits();
      await loadBots();
    } catch (e: any) {
      setMsg(e?.message || "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const botLimitText = useMemo(() => {
    if (botLimitMax == null) return `Agency bots: ${botLimitUsed} (unlimited)`;
    return `Agency bots: ${botLimitUsed} / ${botLimitMax}`;
  }, [botLimitUsed, botLimitMax]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
        <p className="text-sm text-muted-foreground">Agency bots are shared. Private bots are personal.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Bots table */}
        <Card className="card-premium rounded-3xl">
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your bots</CardTitle>
                <CardDescription>Each bot needs a vector store to answer from docs.</CardDescription>
              </div>
              <div className="flex gap-2">
                <Link href="/app/chat">
                  <Button size="sm" variant="secondary" className="rounded-full">
                    Go to chat
                  </Button>
                </Link>
                <Button size="sm" variant="outline" className="rounded-full" onClick={loadBots}>
                  Refresh
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {defaultBot && (
                <span className="text-muted-foreground">
                  Default agency bot: <span className="font-medium text-foreground">{defaultBot.name}</span>
                </span>
              )}
              <Badge variant="outline" className="rounded-full">
                {botLimitText}
              </Badge>
              {plan ? (
                <Badge variant="outline" className="rounded-full">
                  Plan: {plan}
                </Badge>
              ) : null}
              {agencyBotAtCap ? (
                <Badge variant="destructive" className="rounded-full">
                  Agency bot cap reached
                </Badge>
              ) : null}
            </div>

            <Separator />
          </CardHeader>

          <CardContent className="space-y-3">
            {msg && (
              <div
                className={`rounded-2xl border p-3 text-sm ${
                  isError ? "border-red-200 bg-red-50 text-red-700" : "bg-background/60"
                }`}
              >
                {msg}
              </div>
            )}

            <div className="overflow-x-auto rounded-2xl border bg-background/60">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-muted-foreground">
                        Loading…
                      </td>
                    </tr>
                  ) : bots.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-muted-foreground">
                        No bots yet.
                      </td>
                    </tr>
                  ) : (
                    bots.map((b) => {
                      const missing = !b.vector_store_id;
                      const isPrivate = b.scope ? b.scope === "private" : !!b.owner_user_id;

                      return (
                        <tr key={b.id} className="border-b last:border-b-0">
                          <td className="px-4 py-3">
                            <div className="font-medium">{b.name}</div>
                            {b.description && <div className="text-xs text-muted-foreground">{b.description}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="rounded-full">
                              {isPrivate ? "Private bot" : "Agency bot"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {missing ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-amber-200 bg-amber-50 text-amber-800"
                                >
                                  Missing vector store
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 rounded-full px-3"
                                  disabled={repairingId === b.id}
                                  onClick={() => repairVectorStore(b.id)}
                                >
                                  {repairingId === b.id ? "Repairing…" : "Repair"}
                                </Button>
                                <span className="text-xs text-muted-foreground">(requires OpenAI quota/billing)</span>
                              </div>
                            ) : (
                              <Badge variant="outline" className="rounded-full">
                                Ready
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(b.created_at)}</td>
                          <td className="px-4 py-3 text-right">
                            {isPrivate ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 rounded-full px-3"
                                disabled={deletingId === b.id}
                                onClick={() => deleteBot(b)}
                              >
                                {deletingId === b.id ? "Deleting…" : "Delete"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Create bot */}
        <Card className="card-premium rounded-3xl">
          <CardHeader>
            <CardTitle>Create a bot</CardTitle>
            <CardDescription>Examples: Ops Bot, Sales Bot, Brand Bot.</CardDescription>
            <Separator />
          </CardHeader>

          <CardContent className="space-y-3">
            <div>
              <label className="text-sm font-medium">Bot type</label>
              <div className="mt-2 flex gap-2">
                {(["agency", "private"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setScope(t)}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      scope === t ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"
                    }`}
                    type="button"
                  >
                    {t === "agency" ? "Agency bot" : "Private bot"}
                  </button>
                ))}
              </div>
            </div>

            {scope === "agency" ? (
              <div className="rounded-2xl border bg-background/60 p-3 text-xs text-muted-foreground">
                {botLimitMax == null
                  ? `Agency bot limit: unlimited (used ${botLimitUsed}).`
                  : `Agency bot limit: ${botLimitUsed} / ${botLimitMax}.`}
                {agencyBotAtCap ? " Upgrade in Billing to add more." : ""}
              </div>
            ) : null}

            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops Bot" />
            </div>

            <div>
              <label className="text-sm font-medium">Description (optional)</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Internal SOP assistant"
                className="min-h-[90px]"
              />
            </div>

            <Button
              onClick={createBot}
              disabled={creating || !name.trim() || (scope === "agency" && agencyBotAtCap)}
              className="rounded-full"
            >
              {creating ? "Creating..." : "Create bot"}
            </Button>

            {scope === "agency" && agencyBotAtCap ? (
              <div className="text-xs text-muted-foreground">Creation disabled: agency bot limit reached.</div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}