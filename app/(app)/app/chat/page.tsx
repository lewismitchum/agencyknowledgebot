// app/(app)/app/chat/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

function normalizeDailyRemaining(v: unknown): number | null {
  // Canonical: unlimited must be NULL (never 99999 / huge sentinel).
  if (v === null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0;
    if (v >= 90000) return null;
    if (v < 0) return 0;
    return Math.floor(v);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n >= 90000) return null;
  if (n < 0) return 0;
  return Math.floor(n);
}

/**
 * Minimal markdown renderer for assistant output.
 * Supports:
 * - paragraphs / line breaks
 * - bullet/numbered lists
 * - headings (#, ##, ###)
 * - inline code `...`
 * - code blocks ```...```
 *
 * No external deps (keeps bundle light).
 */
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <code key={`i-${m.index}`} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em]">
        {m[1]}
      </code>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function AssistantMarkdown({ text }: { text: string }) {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");

  const blocks: React.ReactNode[] = [];
  let i = 0;

  function flushParagraph(par: string[]) {
    if (!par.length) return;
    const joined = par.join(" ").trim();
    if (!joined) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="whitespace-pre-wrap">
        {renderInline(joined)}
      </p>
    );
  }

  function flushList(kind: "ul" | "ol", items: string[]) {
    if (!items.length) return;
    const ListTag: any = kind;
    blocks.push(
      <ListTag
        key={`${kind}-${blocks.length}`}
        className={kind === "ul" ? "ml-5 list-disc space-y-1" : "ml-5 list-decimal space-y-1"}
      >
        {items.map((it, idx) => (
          <li key={idx} className="whitespace-pre-wrap">
            {renderInline(it)}
          </li>
        ))}
      </ListTag>
    );
  }

  let paragraph: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  function flushAllTextBlocks() {
    flushParagraph(paragraph);
    paragraph = [];
    if (listKind) flushList(listKind, listItems);
    listKind = null;
    listItems = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    // code fence
    if (line.trim().startsWith("```")) {
      flushAllTextBlocks();
      const fence = line.trim();
      const lang = fence.slice(3).trim(); // optional
      i++;

      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      // consume closing fence if present
      if (i < lines.length && lines[i].trim().startsWith("```")) i++;

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded-xl border border-white/10 bg-black/10 p-3 text-[12px] leading-relaxed"
        >
          <code className="font-mono">
            {lang ? `${lang}\n` : ""}
            {codeLines.join("\n")}
          </code>
        </pre>
      );
      continue;
    }

    const trimmed = line.trim();

    // blank line
    if (!trimmed) {
      flushAllTextBlocks();
      i++;
      continue;
    }

    // heading
    const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushAllTextBlocks();
      const level = h[1].length;
      const content = h[2].trim();
      const cls = level === 1 ? "text-base font-semibold" : level === 2 ? "text-sm font-semibold" : "text-sm font-medium";
      const Tag: any = level === 1 ? "h3" : "h4";
      blocks.push(
        <Tag key={`h-${blocks.length}`} className={cls}>
          {renderInline(content)}
        </Tag>
      );
      i++;
      continue;
    }

    // unordered list
    const ul = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (listKind && listKind !== "ul") {
        flushList(listKind, listItems);
        listItems = [];
      }
      flushParagraph(paragraph);
      paragraph = [];
      listKind = "ul";
      listItems.push(ul[1].trim());
      i++;
      continue;
    }

    // ordered list
    const ol = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (listKind && listKind !== "ol") {
        flushList(listKind, listItems);
        listItems = [];
      }
      flushParagraph(paragraph);
      paragraph = [];
      listKind = "ol";
      listItems.push(ol[1].trim());
      i++;
      continue;
    }

    // normal text line (part of paragraph)
    if (listKind) {
      flushList(listKind, listItems);
      listKind = null;
      listItems = [];
    }
    paragraph.push(trimmed);
    i++;
  }

  flushAllTextBlocks();

  return <div className="space-y-2">{blocks.length ? blocks : <span />}</div>;
}

export default function ChatPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);

  const [meStatus, setMeStatus] = useState<"active" | "pending" | "blocked" | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);

  const [documentsCount, setDocumentsCount] = useState(0);

  // Usage
  const [usageLoaded, setUsageLoaded] = useState(false);
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null); // null => unlimited
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

  const docsEmpty = documentsCount <= 0;

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

        // ✅ daily_remaining null => unlimited. Also protect against legacy sentinel (99999).
        setDailyRemaining(normalizeDailyRemaining(j?.daily_remaining));

        const reset = Number(j?.daily_resets_in_seconds ?? 0);
        setDailyResetsInSeconds(reset);
      } catch (e: any) {
        setBootError(e?.message || "Failed to load session");
      } finally {
        setUsageLoaded(true);
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
          setBootError(`405 from ${url}. You likely don't have GET implemented at app/api/conversation/messages/route.ts`);
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
    const t = setInterval(() => setDailyResetsInSeconds((s: number) => Math.max(0, s - 1)), 1000);
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
    if (!input.trim() || loading) return;
    if (accessBlocked) return;

    if (dailyRemaining !== null && dailyRemaining === 0 && dailyResetsInSeconds > 0) return;

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

      setMessages((m: Msg[]) => [...m, { role: "assistant", text: String(j?.answer ?? j?.text ?? "") }]);

      setUsageLoaded(true);

      // Prefer usage block (new). Fall back to daily_remaining (legacy).
      if (j?.usage && typeof j.usage === "object") {
        const used = Number(j.usage.used ?? 0);
        const limit = j.usage.daily_limit == null ? null : Number(j.usage.daily_limit);
        if (limit == null || !Number.isFinite(limit) || limit >= 90000) {
          setDailyRemaining(null);
        } else if (limit >= 0) {
          setDailyRemaining(Math.max(0, Math.floor(limit) - Math.max(0, Math.floor(used))));
        }
      } else {
        setDailyRemaining(normalizeDailyRemaining(j?.daily_remaining));
      }
    } catch (e: any) {
      setMessages((m: Msg[]) => [...m, { role: "assistant", text: `Network error: ${String(e?.message ?? e)}` }]);
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

  const dailyKnown = usageLoaded;
  const dailyBlocked = dailyRemaining !== null && dailyResetsInSeconds > 0 && dailyRemaining === 0;

  const canSend = !!selectedBotId && !loading && !accessBlocked && !dailyBlocked && input.trim().length > 0;

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
          <CardDescription>Docs-prioritized agency assistant (general questions allowed)</CardDescription>

          {bootError ? <div className="text-sm text-destructive">{bootError}</div> : null}

          <div className="flex flex-wrap items-center gap-2">
            {!dailyKnown ? (
              <Badge variant="outline">Usage loading…</Badge>
            ) : dailyRemaining === null ? (
              <Badge variant="secondary">Unlimited</Badge>
            ) : dailyRemaining > 0 ? (
              <Badge>{dailyRemaining} left today</Badge>
            ) : dailyResetsInSeconds > 0 ? (
              <Badge>{dailyRemaining} left today</Badge>
            ) : (
              <Badge variant="outline">Usage unavailable</Badge>
            )}

            <Badge variant={emailVerified ? "secondary" : "outline"}>{emailVerified ? "Verified" : "Unverified"}</Badge>

            {dailyRemaining !== null && dailyResetsInSeconds > 0 ? (
              <Badge variant="outline">Resets in {formatCountdown(dailyResetsInSeconds)}</Badge>
            ) : null}

            {documentsCount > 0 ? (
              <Badge variant="secondary">{documentsCount} docs</Badge>
            ) : (
              <Badge variant="outline">No docs yet</Badge>
            )}
          </div>

          {docsEmpty ? (
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm">
              <div className="font-medium">No docs uploaded yet</div>
              <div className="mt-1 text-xs text-muted-foreground">
                You can still ask general questions. For internal/workspace answers, upload at least one doc so Louis can cite it.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" className="rounded-full">
                  <Link href="/app/docs">Upload docs</Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => window.location.reload()}
                >
                  Refresh
                </Button>
              </div>
            </div>
          ) : null}

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-muted-foreground">
              Bot:{" "}
              <span className="text-foreground font-medium">{botsLoading ? "Loading…" : selectedBotName || "None"}</span>
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
                {selectedBotId ? "Ask anything. Louis will use your docs when relevant." : "Select a bot to start chatting."}
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
                      {m.role === "assistant" ? <AssistantMarkdown text={m.text} /> : <span className="whitespace-pre-wrap">{m.text}</span>}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="rounded-[22px] bg-background/60 px-4 py-3 text-sm text-muted-foreground">Thinking…</div>
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
                : dailyBlocked
                ? "Daily limit reached…"
                : docsEmpty
                ? "Ask anything… (Upload docs for internal answers)"
                : "Ask a question… (Ctrl/⌘ + Enter to send)"
            }
            disabled={!selectedBotId || dailyBlocked}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
            }}
          />

          <Button onClick={send} disabled={!canSend}>
            {loading ? "Sending…" : dailyBlocked ? "Daily limit reached" : "Send"}
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4 text-xs text-muted-foreground">
        Need to manage bots?{" "}
        <Link className="underline" href="/app/bots">
          Go to Bots
        </Link>
      </div>
    </div>
  );
}