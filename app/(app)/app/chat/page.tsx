"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

type Msg = { role: "user" | "assistant"; text: string };
type BotRow = { id: string; name: string };

function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h <= 0 ? `${m}m` : `${h}h ${m}m`;
}

function getBotIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("bot_id") || "";
  } catch {
    return "";
  }
}

function setBotIdInUrl(botId: string) {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("bot_id", botId);
    window.history.replaceState({}, "", u.toString());
  } catch {}
}

async function safeJson(r: Response) {
  return await r.json().catch(async () => {
    const t = await r.text().catch(() => "");
    return { _raw: t };
  });
}

export default function ChatPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);

  const [meStatus, setMeStatus] = useState<"active" | "pending" | "blocked" | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);

  const [documentsCount, setDocumentsCount] = useState(0);
  const [dailyRemaining, setDailyRemaining] = useState(0);
  const [dailyResetsInSeconds, setDailyResetsInSeconds] = useState(0);

  const [bots, setBots] = useState<BotRow[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState("");

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [bootError, setBootError] = useState("");
  const [accessBlocked, setAccessBlocked] = useState<"pending" | "blocked" | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedBotName = useMemo(
    () => bots.find((b: BotRow) => b.id === selectedBotId)?.name ?? "",
    [bots, selectedBotId]
  );

  useEffect(() => {
    const initialFromUrl = getBotIdFromUrl();
    if (initialFromUrl) setSelectedBotId(initialFromUrl);
  }, []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    window.location.href = "/login";
  }

  /* session */
  useEffect(() => {
    (async () => {
      try {
        setBootError("");
        const r = await fetch("/api/me", { credentials: "include" });

        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }

        // ✅ handle pending/blocked (authz returns 403)
        if (r.status === 403) {
          const j = await safeJson(r);
          const message = String((j as any)?.message ?? "").toLowerCase();
          setAccessBlocked(message.includes("blocked") ? "blocked" : "pending");
          setMeStatus(message.includes("blocked") ? "blocked" : "pending");
          return;
        }

        if (!r.ok) {
          const raw = await r.text().catch(() => "");
          setBootError(raw || `Failed to load session (${r.status})`);
          return;
        }

        const j: any = await safeJson(r);

        setEmail(j?.user?.email ?? null);
        setEmailVerified(Boolean(j?.user?.email_verified));

        const status = String(j?.user?.status ?? "active").toLowerCase();
        const role = String(j?.user?.role ?? "member").toLowerCase();
        setMeRole(role);

        if (status === "blocked") setMeStatus("blocked");
        else if (status === "pending") setMeStatus("pending");
        else setMeStatus("active");

        if (status === "blocked") {
          setAccessBlocked("blocked");
          return;
        }
        if (status === "pending") {
          setAccessBlocked("pending");
          return;
        }

        setDocumentsCount(Number(j?.documents_count ?? 0));
        setDailyRemaining(Number(j?.daily_remaining ?? 0));
        setDailyResetsInSeconds(Number(j?.daily_resets_in_seconds ?? 0));
      } catch (e: any) {
        setBootError(e?.message || "Failed to load session");
      }
    })();
  }, []);

  /* bots */
  useEffect(() => {
    if (accessBlocked) {
      setBots([]);
      setBotsLoading(false);
      return;
    }

    (async () => {
      try {
        setBootError("");
        const r = await fetch("/api/bots", { credentials: "include" });

        if (r.status === 401) return (window.location.href = "/login");

        if (r.status === 403) {
          setAccessBlocked("pending");
          setBots([]);
          return;
        }

        if (r.status === 405) {
          setBootError(`405 from /api/bots (method mismatch). Check app/api/bots/route.ts exports GET.`);
          setBots([]);
          return;
        }

        const j: any = await safeJson(r);
        const list: BotRow[] = Array.isArray(j?.bots) ? (j.bots as BotRow[]) : [];
        setBots(list);

        const urlBotId = getBotIdFromUrl();
        const urlIsValid = !!urlBotId && list.some((b: BotRow) => b.id === urlBotId);
        const stateIsValid = !!selectedBotId && list.some((b: BotRow) => b.id === selectedBotId);

        let next = "";
        if (urlIsValid) next = urlBotId;
        else if (stateIsValid) next = selectedBotId;
        else if (list.length) next = list[0].id;

        if (next) {
          setSelectedBotId(next);
          setBotIdInUrl(next);
        }
      } catch (e: any) {
        setBootError(`Failed to load bots: ${String(e?.message ?? e)}`);
        setBots([]);
      } finally {
        setBotsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessBlocked]);

  /* hydrate messages when bot changes */
  useEffect(() => {
    if (!selectedBotId) return;
    if (accessBlocked) return;

    (async () => {
      try {
        setBootError("");
        const url = `/api/conversation/messages?bot_id=${encodeURIComponent(selectedBotId)}`;
        const r = await fetch(url, { credentials: "include" });

        if (r.status === 405) {
          setBootError(
            `405 from ${url}. You likely don't have GET implemented at app/api/conversation/messages/route.ts`
          );
          setMessages([]);
          return;
        }

        if (!r.ok) {
          setMessages([]);
          return;
        }

        const j: any = await safeJson(r);
        setMessages(Array.isArray(j?.messages) ? (j.messages as Msg[]) : []);
      } catch {
        setMessages([]);
      }
    })();
  }, [selectedBotId, accessBlocked]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (dailyResetsInSeconds <= 0) return;
    const t = setInterval(
      () => setDailyResetsInSeconds((s: number) => Math.max(0, s - 1)),
      1000
    );
    return () => clearInterval(t);
  }, [dailyResetsInSeconds]);

  function onChangeBot(nextId: string) {
    if (!nextId) return;
    if (nextId === selectedBotId) return;

    setLoading(false);
    setInput("");
    setMessages([]);

    setSelectedBotId(nextId);
    setBotIdInUrl(nextId);
  }

  async function send() {
    if (!selectedBotId) return;
    if (!input.trim() || loading || documentsCount === 0 || dailyRemaining === 0) return;
    if (accessBlocked) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((m: Msg[]) => [...m, { role: "user", text: userMsg }]);
    setLoading(true);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMsg, bot_id: selectedBotId }),
      });

      if (r.status === 405) {
        setMessages((m: Msg[]) => [
          ...m,
          {
            role: "assistant",
            text:
              "405 from /api/chat. This usually means your server route doesn’t export POST at app/api/chat/route.ts, " +
              "or another route is shadowing it (pages/api/chat.ts).",
          },
        ]);
        return;
      }

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (r.status === 403) {
        setAccessBlocked("pending");
        setMessages((m: Msg[]) => [
          ...m,
          {
            role: "assistant",
            text: "Your account is pending approval by the agency owner. You’ll be able to chat once you’re approved.",
          },
        ]);
        return;
      }

      const j: any = await safeJson(r);

      if (j?.bot_id && typeof j.bot_id === "string" && j.bot_id !== selectedBotId) {
        onChangeBot(j.bot_id);
        return;
      }

      setMessages((m: Msg[]) => [
        ...m,
        { role: "assistant", text: String(j?.answer ?? j?.text ?? "") },
      ]);

      if (typeof j?.daily_remaining === "number") {
        setDailyRemaining(j.daily_remaining);
      }
    } catch (e: any) {
      setMessages((m: Msg[]) => [
        ...m,
        { role: "assistant", text: `Network error: ${String(e?.message ?? e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function newChat() {
    if (!selectedBotId) return;
    if (accessBlocked) return;

    try {
      const r = await fetch("/api/conversation/reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: selectedBotId }),
      });

      if (r.status === 405) {
        setBootError(
          `405 from /api/conversation/reset. You likely don't have POST implemented at app/api/conversation/reset/route.ts`
        );
      }
    } catch {}
    setMessages([]);
  }

  const canSend =
    !!selectedBotId &&
    !loading &&
    !accessBlocked &&
    documentsCount > 0 &&
    dailyRemaining > 0 &&
    input.trim().length > 0;

  // ✅ Pending / blocked UI (clean UX)
  if (accessBlocked) {
    const title = accessBlocked === "blocked" ? "Access blocked" : "Pending approval";
    const desc =
      accessBlocked === "blocked"
        ? "Your account has been blocked by the agency owner. Contact your owner if you think this is a mistake."
        : "Your account is pending approval by the agency owner. You’ll be able to use Louis.Ai once approved.";

    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{email || "Unknown user"}</Badge>
              <Badge variant="outline">Role: {meRole || "member"}</Badge>
              <Badge variant={accessBlocked === "blocked" ? "destructive" : "outline"}>
                Status: {meStatus || accessBlocked}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="rounded-full" onClick={() => window.location.reload()}>
                Refresh
              </Button>
              <Button variant="outline" className="rounded-full" onClick={logout}>
                Log out
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/accept-invite">Invite link</Link>
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              If you are the owner, go to{" "}
              <Link className="underline" href="/app/settings/members">
                Members
              </Link>{" "}
              and approve this user.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Card className="overflow-hidden rounded-3xl">
        <CardHeader className="space-y-3">
          <CardTitle className="text-xl">Louis.Ai</CardTitle>
          <CardDescription>Docs-only agency knowledge assistant</CardDescription>

          {bootError ? <div className="text-sm text-destructive">{bootError}</div> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Badge>{dailyRemaining} left today</Badge>
            <Badge variant={emailVerified ? "secondary" : "outline"}>
              {emailVerified ? "Verified" : "Unverified"}
            </Badge>
            {dailyResetsInSeconds > 0 ? (
              <Badge variant="outline">Resets in {formatCountdown(dailyResetsInSeconds)}</Badge>
            ) : null}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-muted-foreground">
              Bot:{" "}
              <span className="text-foreground font-medium">
                {botsLoading ? "Loading…" : selectedBotName || "None"}
              </span>
            </div>

            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={selectedBotId}
              disabled={botsLoading || bots.length === 0}
              onChange={(e) => onChangeBot(e.target.value)}
            >
              {bots.length === 0 ? (
                <option value="">No bots found</option>
              ) : (
                bots.map((b: BotRow) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))
              )}
            </select>

            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={newChat} disabled={!selectedBotId}>
                New chat
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="h-[460px] overflow-y-auto rounded-[28px] border border-white/10 bg-background/50 p-4 shadow-sm backdrop-blur-xl">
            {messages.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {selectedBotId ? "Ask a question from your uploaded docs." : "Select a bot to start chatting."}
              </div>
            ) : (
              <div className="grid gap-3">
                {messages.map((m: Msg, i: number) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-[22px] px-4 py-3 text-sm leading-relaxed shadow-sm border border-white/10 backdrop-blur-xl ${
                        m.role === "user" ? "bg-foreground text-background" : "bg-background/60 text-foreground"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="rounded-[22px] bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                    Thinking…
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              !selectedBotId
                ? "Select a bot first…"
                : documentsCount === 0
                ? "Upload documents to enable answers…"
                : dailyRemaining === 0
                ? "Daily limit reached…"
                : "Ask a question…"
            }
            disabled={!selectedBotId || documentsCount === 0 || dailyRemaining === 0}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
            }}
          />
          <Button onClick={send} disabled={!canSend}>
            {loading ? "Sending…" : "Send"}
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4 text-xs text-muted-foreground">
        Need to manage bots?{" "}
        <Link className="underline" href="/bots">
          Go to Bots
        </Link>
      </div>
    </div>
  );
}
