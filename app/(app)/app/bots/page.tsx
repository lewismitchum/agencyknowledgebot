// app/(app)/app/bots/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";

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

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function pickMaxAgencyBotsFromAny(limits: any): number | null {
  const raw =
    limits?.max_agency_bots ?? limits?.agency_bots ?? limits?.max_bots ?? limits?.bots ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function prettyPlan(plan: string | null | undefined) {
  const v = String(plan || "").toLowerCase();
  if (v === "personal" || v === "home") return "Home";
  if (v === "pro") return "Pro";
  if (v === "enterprise") return "Enterprise";
  if (v === "corp" || v === "corporation") return "Corporation";
  return "Free";
}

function TopStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border bg-background/80 p-5 shadow-sm transition hover:-translate-y-[2px] hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
          <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
        </div>

        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-muted/30 text-muted-foreground shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
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

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const [plan, setPlan] = useState<string | null>(null);
  const [limits, setLimits] = useState<any>(null);
  const [botLimitUsed, setBotLimitUsed] = useState<number>(0);
  const [botLimitMax, setBotLimitMax] = useState<number | null>(null);

  const [meRole, setMeRole] = useState<"owner" | "admin" | "member">("member");
  const [meUserId, setMeUserId] = useState<string>("");

  async function loadBots() {
    setLoading(true);
    setMsg("");
    try {
      const j = (await fetchJson<any>("/api/bots", {
        credentials: "include",
        cache: "no-store",
      })) as BotsResponse | any;

      const rows = Array.isArray(j?.bots) ? j.bots : [];
      const normalized: BotRow[] = rows.map((b: any) => ({
        id: String(b.id),
        name: String(b.name ?? "Untitled Bot"),
        description: null,
        owner_user_id: b.owner_user_id ?? null,
        vector_store_id: b.vector_store_id ?? null,
        created_at: b.created_at ?? null,
        scope: b.scope === "private" ? "private" : "agency",
      }));

      setBots(normalized);
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }
        const body = String(e.info.bodyText || "").trim();
        setMsg(body || `Failed to load bots (${e.info.status})`);
      } else {
        setMsg(e?.message || "Failed to load bots");
      }
      setBots([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMe() {
    try {
      const j = await fetchJson<any>("/api/me", { credentials: "include", cache: "no-store" });

      const p = String(j?.plan ?? j?.agency?.plan ?? "") || null;
      setPlan(p);
      setLimits(j?.limits ?? null);

      const roleRaw = String(j?.user?.role ?? "member").toLowerCase();
      setMeRole(roleRaw === "owner" ? "owner" : roleRaw === "admin" ? "admin" : "member");
      setMeUserId(String(j?.user?.id ?? ""));
    } catch (e: any) {
      if (e instanceof FetchJsonError && (e.info.status === 401 || e.info.status === 403)) return;
    }
  }

  useEffect(() => {
    loadMe();
    loadBots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const used = bots.filter((b) => (b.scope ? b.scope === "agency" : !b.owner_user_id)).length;
    setBotLimitUsed(used);

    const max = pickMaxAgencyBotsFromAny(limits);
    setBotLimitMax(max);
  }, [bots, limits]);

  const defaultBot = useMemo(
    () => bots.find((b) => (b.scope ? b.scope === "agency" : b.owner_user_id == null)) ?? null,
    [bots]
  );

  const agencyBotAtCap = useMemo(() => {
    if (botLimitMax == null) return false;
    return botLimitUsed >= botLimitMax;
  }, [botLimitUsed, botLimitMax]);

  const agencyBotsCount = useMemo(
    () => bots.filter((b) => (b.scope ? b.scope === "agency" : b.owner_user_id == null)).length,
    [bots]
  );

  const privateBotsCount = useMemo(
    () => bots.filter((b) => (b.scope ? b.scope === "private" : !!b.owner_user_id)).length,
    [bots]
  );

  const readyBotsCount = useMemo(() => bots.filter((b) => !!b.vector_store_id).length, [bots]);

  const missingVectorCount = useMemo(() => bots.filter((b) => !b.vector_store_id).length, [bots]);

  const isError = /fail|error|required|cannot|unauth|forbidden|quota|billing|limit/i.test(msg);

  function canManageBot(bot: BotRow) {
    const isPrivate = bot.scope ? bot.scope === "private" : !!bot.owner_user_id;
    if (isPrivate) return !!meUserId && String(bot.owner_user_id ?? "") === meUserId;
    return meRole === "owner" || meRole === "admin";
  }

  function canRenameBot(bot: BotRow) {
    return canManageBot(bot);
  }

  function canDeleteBot(bot: BotRow) {
    return canManageBot(bot);
  }

  function startRename(bot: BotRow) {
    setMsg("");
    setRenamingId(bot.id);
    setRenameValue(bot.name ?? "");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  async function submitRename(bot: BotRow) {
    const next = renameValue.trim();
    if (!next) {
      setMsg("Name is required.");
      return;
    }

    setMsg("");
    setRenamingId(bot.id);

    try {
      await fetchJson<any>(`/api/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: next }),
      });

      setMsg("Bot renamed.");
      cancelRename();
      await loadBots();
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }
        const raw = String(e.info.bodyText || "").trim();

        if (raw === "FORBIDDEN_PRIVATE_BOT") setMsg("You can only rename your own private bots.");
        else if (raw === "FORBIDDEN_NOT_ADMIN_OR_OWNER" || raw === "FORBIDDEN_NOT_OWNER")
          setMsg("Owner/admin only.");
        else setMsg(raw || `Rename failed (${e.info.status})`);

        return;
      }

      setMsg(e?.message || "Rename failed");
    } finally {
      if (renamingId && renamingId !== bot.id) setRenamingId(null);
    }
  }

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
      await fetchJson<any>("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          scope,
        }),
      });

      setMsg("Bot created.");
      setName("");
      setDescription("");
      await loadMe();
      await loadBots();
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }

        const body = String(e.info.bodyText || "").trim();

        if (body.includes("BOT_LIMIT_EXCEEDED")) {
          const used = botLimitUsed;
          const limit = botLimitMax ?? null;
          setMsg(
            limit == null
              ? "Agency bot limit reached."
              : `Agency bot limit reached (${used} / ${limit}). Upgrade in Billing.`
          );
          await loadMe();
          await loadBots();
          return;
        }

        if (
          body.includes("FORBIDDEN_NOT_ADMIN_OR_OWNER") ||
          body.includes("FORBIDDEN_NOT_OWNER")
        ) {
          setMsg("Only owner/admin can create agency bots.");
          return;
        }

        setMsg(body || `Create failed (${e.info.status})`);
        return;
      }

      setMsg(e?.message || "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function repairVectorStore(botId: string) {
    setMsg("");
    setRepairingId(botId);
    try {
      await fetchJson<any>("/api/admin/fix-vector-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_id: botId }),
      });

      setMsg("Vector store attached.");
      await loadBots();
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }
        const body = String(e.info.bodyText || "").trim();
        setMsg(body || `Repair failed (${e.info.status})`);
        return;
      }
      setMsg(e?.message || "Repair failed");
    } finally {
      setRepairingId(null);
    }
  }

  async function deleteBot(bot: BotRow) {
    setMsg("");

    if (!canDeleteBot(bot)) {
      setMsg("You don’t have permission to delete this bot.");
      return;
    }

    const okConfirm = window.confirm(
      `Delete "${bot.name}"?\n\nThis will remove the bot and related data. This cannot be undone.`
    );
    if (!okConfirm) return;

    setDeletingId(bot.id);
    try {
      await fetchJson<any>(`/api/bots/${encodeURIComponent(bot.id)}`, {
        method: "DELETE",
        credentials: "include",
      });

      setMsg("Bot deleted.");
      await loadMe();
      await loadBots();
    } catch (e: any) {
      if (e instanceof FetchJsonError) {
        if (e.info.status === 401) {
          window.location.href = "/login";
          return;
        }

        const raw = String(e.info.bodyText || "").trim();

        if (raw === "FORBIDDEN_PRIVATE_BOT") setMsg("You can only delete your own private bots.");
        else if (raw === "FORBIDDEN_NOT_ADMIN_OR_OWNER" || raw === "FORBIDDEN_NOT_OWNER")
          setMsg("Owner/admin only.");
        else setMsg(raw || `Delete failed (${e.info.status})`);

        return;
      }

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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <section className="relative overflow-hidden rounded-[32px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.10),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Workspace bots
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
              Create bots for every workflow.
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Agency bots are shared across your workspace. Private bots stay personal. Each bot
              needs a vector store to answer from docs reliably.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded-full px-3 py-1">
                Shared + private bots
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Docs-backed answers
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Role-based control
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Vector-store repair
              </Badge>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[280px]">
            <Button asChild className="h-11 rounded-2xl">
              <Link href="/app/chat">Go to chat</Link>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={loadBots}
              className="h-11 rounded-2xl"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh bots
            </Button>
          </div>
        </div>

        <div className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <TopStat
            icon={<Building2 className="h-5 w-5" />}
            label="Agency bots"
            value={String(agencyBotsCount)}
            hint={botLimitMax == null ? "Unlimited on current plan" : `Limit ${botLimitMax}`}
          />
          <TopStat
            icon={<Lock className="h-5 w-5" />}
            label="Private bots"
            value={String(privateBotsCount)}
            hint="Visible only to their owner"
          />
          <TopStat
            icon={<ShieldCheck className="h-5 w-5" />}
            label="Ready"
            value={String(readyBotsCount)}
            hint="Bots with vector stores attached"
          />
          <TopStat
            icon={<Wrench className="h-5 w-5" />}
            label="Need repair"
            value={String(missingVectorCount)}
            hint="Missing vector stores"
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-xl tracking-tight">Your bots</CardTitle>
                <CardDescription className="mt-2">
                  Manage workspace bots, repair vector stores, and keep assistants organized.
                </CardDescription>
              </div>

              <div className="flex flex-wrap gap-2">
                {defaultBot ? (
                  <Badge variant="outline" className="rounded-full">
                    Default agency bot: {defaultBot.name}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="rounded-full">
                  {botLimitText}
                </Badge>
                {plan ? (
                  <Badge variant="outline" className="rounded-full">
                    Plan: {prettyPlan(plan)}
                  </Badge>
                ) : null}
                {agencyBotAtCap ? (
                  <Badge variant="destructive" className="rounded-full">
                    Agency bot cap reached
                  </Badge>
                ) : null}
                <Badge variant="outline" className="rounded-full">
                  Role: {meRole}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {msg ? (
              <div
                className={`rounded-3xl border p-4 text-sm ${
                  isError
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-100"
                    : "bg-background"
                }`}
              >
                {msg}
              </div>
            ) : null}

            {loading ? (
              <div className="rounded-[28px] border bg-muted/20 p-8 text-sm text-muted-foreground">
                Loading bots…
              </div>
            ) : bots.length === 0 ? (
              <div className="rounded-[28px] border bg-muted/20 p-10 text-center">
                <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-3xl border bg-background/80">
                  <Bot className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="mt-4 text-lg font-semibold tracking-tight">No bots yet</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Create your first bot on the right to start organizing knowledge.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {bots.map((b) => {
                  const missing = !b.vector_store_id;
                  const isPrivate = b.scope ? b.scope === "private" : !!b.owner_user_id;
                  const canManage = canManageBot(b);

                  return (
                    <div
                      key={b.id}
                      className="rounded-[28px] border bg-background p-5 shadow-sm transition hover:-translate-y-[2px] hover:shadow-md"
                    >
                      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          {renamingId === b.id ? (
                            <div className="max-w-md space-y-3">
                              <Input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                placeholder="Bot name"
                                className="rounded-2xl"
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  className="h-9 rounded-full px-4"
                                  onClick={() => submitRename(b)}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-9 rounded-full px-4"
                                  onClick={cancelRename}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start gap-3">
                                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-muted/30 text-muted-foreground shadow-sm">
                                  {isPrivate ? (
                                    <Lock className="h-4 w-4" />
                                  ) : (
                                    <Building2 className="h-4 w-4" />
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="truncate text-base font-semibold tracking-tight">
                                      {b.name}
                                    </div>
                                    <Badge variant="outline" className="rounded-full">
                                      {isPrivate ? "Private" : "Agency"}
                                    </Badge>
                                    {missing ? (
                                      <Badge
                                        variant="outline"
                                        className="rounded-full border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100"
                                      >
                                        Missing vector store
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary" className="rounded-full">
                                        Ready
                                      </Badge>
                                    )}
                                  </div>

                                  <div className="mt-2 text-sm text-muted-foreground">
                                    {isPrivate
                                      ? "Private bot visible only to you."
                                      : "Agency bot shared across the workspace."}
                                  </div>

                                  {b.description ? (
                                    <div className="mt-2 text-sm text-muted-foreground">
                                      {b.description}
                                    </div>
                                  ) : null}
                                </div>
                              </div>

                              <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                                <div className="rounded-2xl border bg-muted/20 px-3 py-2">
                                  Created: {formatDate(b.created_at)}
                                </div>
                                <div className="rounded-2xl border bg-muted/20 px-3 py-2">
                                  Vector store: {missing ? "Missing" : "Attached"}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[320px]">
                          {missing ? (
                            <div className="rounded-3xl border bg-muted/20 p-4">
                              <div className="text-sm font-semibold">Repair required</div>
                              <div className="mt-2 text-sm text-muted-foreground">
                                This bot needs a vector store before it can answer from uploaded docs.
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="mt-3 h-9 rounded-full px-4"
                                disabled={repairingId === b.id}
                                onClick={() => repairVectorStore(b.id)}
                              >
                                {repairingId === b.id ? "Repairing…" : "Repair vector store"}
                              </Button>
                            </div>
                          ) : null}

                          <div className="flex flex-wrap gap-2 xl:justify-end">
                            {canManage && renamingId !== b.id ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 rounded-full px-4"
                                onClick={() => startRename(b)}
                                disabled={!canRenameBot(b)}
                              >
                                Rename
                              </Button>
                            ) : null}

                            {canManage ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-9 rounded-full px-4"
                                disabled={deletingId === b.id || !canDeleteBot(b)}
                                onClick={() => deleteBot(b)}
                              >
                                {deletingId === b.id ? "Deleting…" : "Delete"}
                              </Button>
                            ) : (
                              <span className="self-center text-xs text-muted-foreground">No actions</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[28px] border shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-xl tracking-tight">Create a bot</CardTitle>
                  <CardDescription className="mt-2">
                    Examples: Ops Bot, Sales Bot, Brand Bot, Support Bot.
                  </CardDescription>
                </div>

                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-muted/30 text-muted-foreground shadow-sm">
                  <Plus className="h-5 w-5" />
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              <div>
                <label className="text-sm font-medium">Bot type</label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setScope("agency")}
                    className={`rounded-2xl border px-4 py-4 text-sm transition ${
                      scope === "agency"
                        ? "border-foreground/15 bg-foreground text-background shadow-sm"
                        : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                    type="button"
                  >
                    <div className="flex flex-col items-start gap-1 text-left">
                      <span className="font-medium">Agency bot</span>
                      <span
                        className={`text-xs ${
                          scope === "agency" ? "text-background/80" : "text-muted-foreground"
                        }`}
                      >
                        Shared with your workspace
                      </span>
                    </div>
                  </button>

                  <button
                    onClick={() => setScope("private")}
                    className={`rounded-2xl border px-4 py-4 text-sm transition ${
                      scope === "private"
                        ? "border-foreground/15 bg-foreground text-background shadow-sm"
                        : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                    type="button"
                  >
                    <div className="flex flex-col items-start gap-1 text-left">
                      <span className="font-medium">Private bot</span>
                      <span
                        className={`text-xs ${
                          scope === "private" ? "text-background/80" : "text-muted-foreground"
                        }`}
                      >
                        Visible only to you
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {scope === "agency" ? (
                <div className="rounded-3xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                  {botLimitMax == null
                    ? `Agency bot limit: unlimited (used ${botLimitUsed}).`
                    : `Agency bot limit: ${botLimitUsed} / ${botLimitMax}.`}
                  {agencyBotAtCap ? " Upgrade in Billing to add more." : ""}
                </div>
              ) : null}

              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={scope === "agency" ? "Ops Bot" : "My Personal Bot"}
                  className="mt-2 rounded-2xl"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Description (optional)</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Internal SOP assistant"
                  className="mt-2 min-h-[110px] rounded-2xl"
                />
              </div>

              <Button
                onClick={createBot}
                disabled={creating || !name.trim() || (scope === "agency" && agencyBotAtCap)}
                className="h-11 w-full rounded-2xl"
              >
                {creating ? "Creating..." : "Create bot"}
              </Button>

              {scope === "agency" && agencyBotAtCap ? (
                <div className="text-xs text-muted-foreground">
                  Creation disabled: agency bot limit reached.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl tracking-tight">Bot rules</CardTitle>
              <CardDescription className="mt-2">
                Quick reminders for how bot ownership and knowledge work.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="rounded-3xl border bg-background p-4 shadow-sm">
                <div className="text-sm font-semibold">Agency bots</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Shared across the workspace and typically managed by owner/admin.
                </div>
              </div>

              <div className="rounded-3xl border bg-background p-4 shadow-sm">
                <div className="text-sm font-semibold">Private bots</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Personal to one user and not visible to the rest of the agency.
                </div>
              </div>

              <div className="rounded-3xl border bg-background p-4 shadow-sm">
                <div className="text-sm font-semibold">Vector stores</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Bots need a vector store attached before docs-based answers work reliably.
                </div>
              </div>

              <div className="rounded-3xl border bg-muted/20 p-4">
                <div className="text-sm font-semibold">Need more shared bots?</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Upgrade your workspace plan for more agency bots and premium features.
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild className="rounded-full">
                    <Link href="/app/billing">Go to Billing</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link href="/app/docs">
                      Open Docs
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}