"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function BotsPage() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [scope, setScope] = useState<"agency" | "user">("agency");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");

  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadBots() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/bots", { credentials: "include" });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(j?.error || "Failed to load bots");
        setBots([]);
        return;
      }
      setBots(Array.isArray(j?.bots) ? j.bots : []);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load bots");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBots();
  }, []);

  const defaultBot = useMemo(
    () => bots.find((b) => b.owner_user_id == null) ?? null,
    [bots]
  );

  async function createBot() {
    setMsg("");
    if (!name.trim()) {
      setMsg("Name is required.");
      return;
    }

    setCreating(true);
    try {
      const endpoint = scope === "user" ? "/api/user-bots" : "/api/bots";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(j?.error || "Create failed");
        return;
      }

      setMsg(j?.warning || "Bot created.");
      setName("");
      setDescription("");
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
    if (!bot.owner_user_id) {
      setMsg("Agency bots cannot be deleted (yet).");
      return;
    }

    const ok = window.confirm(
      `Delete "${bot.name}"?\n\nThis will remove the bot and related data. This cannot be undone.`
    );
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
      await loadBots();
    } catch (e: any) {
      setMsg(e?.message || "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const isError = /fail|error|required|cannot|unauth|forbidden|quota|billing/i.test(
    msg
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
        <p className="text-sm text-muted-foreground">
          Agency bots are shared. User bots are private.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Bots table */}
        <Card className="card-premium rounded-3xl">
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your bots</CardTitle>
                <CardDescription>
                  Each bot needs a vector store to answer from docs.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Link href="/app/chat">
                  <Button size="sm" variant="secondary" className="rounded-full">
                    Go to chat
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={loadBots}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {defaultBot && (
              <div className="text-xs text-muted-foreground">
                Default agency bot:{" "}
                <span className="font-medium text-foreground">
                  {defaultBot.name}
                </span>
              </div>
            )}

            <Separator />
          </CardHeader>

          <CardContent className="space-y-3">
            {msg && (
              <div
                className={`rounded-2xl border p-3 text-sm ${
                  isError
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "bg-background/60"
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
                      return (
                        <tr key={b.id} className="border-b last:border-b-0">
                          <td className="px-4 py-3">
                            <div className="font-medium">{b.name}</div>
                            {b.description && (
                              <div className="text-xs text-muted-foreground">
                                {b.description}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="rounded-full">
                              {b.owner_user_id ? "User bot" : "Agency bot"}
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
                                <span className="text-xs text-muted-foreground">
                                  (requires OpenAI quota/billing)
                                </span>
                              </div>
                            ) : (
                              <Badge variant="outline" className="rounded-full">
                                Ready
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDate(b.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {b.owner_user_id ? (
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
            <CardDescription>
              Examples: Ops Bot, Sales Bot, Brand Bot.
            </CardDescription>
            <Separator />
          </CardHeader>

          <CardContent className="space-y-3">
            <div>
              <label className="text-sm font-medium">Bot type</label>
              <div className="mt-2 flex gap-2">
                {(["agency", "user"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setScope(t)}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      scope === t
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {t === "agency" ? "Agency bot" : "Private user bot"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ops Bot"
              />
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
              disabled={creating || !name.trim()}
              className="rounded-full"
            >
              {creating ? "Creating..." : "Create bot"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
