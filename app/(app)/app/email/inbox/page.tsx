// app/(app)/app/email/inbox/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type Bot = {
  id: string;
  name: string;
  owner_user_id?: string | null;
};

type ThreadRow = {
  id: string;
  subject: string;
  last_from: string;
  last_snippet: string;
  messages_count: number;
};

type ThreadMessage = {
  id: string;
  internalDate: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
};

type Thread = {
  id: string;
  subject: string;
  last_from: string;
  last_snippet: string;
  messages: ThreadMessage[];
};

type AiMsg = { role: "user" | "assistant"; text: string; at: number };

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function shortText(s: string, max = 84) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(10, max - 12)) + "…" + t.slice(-10);
}

export default function EmailInboxPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const [error, setError] = useState("");

  const [connected, setConnected] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  // Bots (needed for AI reply drafting)
  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState("");

  // Search
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");

  // Threads list
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [threads, setThreads] = useState<ThreadRow[]>([]);

  // Open thread
  const [openId, setOpenId] = useState<string | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState("");
  const [openThread, setOpenThread] = useState<Thread | null>(null);

  // AI panel
  const [aiOpen, setAiOpen] = useState(true);
  const [aiMsgs, setAiMsgs] = useState<AiMsg[]>([]);
  const [aiInput, setAiInput] = useState("");
  const aiScrollRef = useRef<HTMLDivElement | null>(null);

  // Reply flow (Gmail-like editor)
  const [replyDrafting, setReplyDrafting] = useState(false);
  const [replyDraftError, setReplyDraftError] = useState("");
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendOk, setSendOk] = useState<string | null>(null);

  const canLoadThreads = useMemo(() => connected && !threadsLoading, [connected, threadsLoading]);

  const canUseAi = useMemo(() => {
    return connected && !!openId && botId.trim().length > 0 && !replyDrafting;
  }, [connected, openId, botId, replyDrafting]);

  const filteredThreads = useMemo(() => {
    const query = String(qApplied || "").trim().toLowerCase();
    if (!query) return threads;

    return threads.filter((t) => {
      const hay = `${t.subject || ""} ${t.last_from || ""} ${t.last_snippet || ""}`.toLowerCase();
      return hay.includes(query);
    });
  }, [threads, qApplied]);

  useEffect(() => {
    if (!aiScrollRef.current) return;
    aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight;
  }, [aiMsgs, aiOpen]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const j = await fetchJson<any>("/api/email/inbox", { credentials: "include", cache: "no-store" });
        if (cancelled) return;

        setPlan(typeof j?.plan === "string" ? j.plan : undefined);
        setUpsell(j?.upsell ?? null);

        if (j?.ok) {
          const isConnected = Boolean(j?.connected);
          setConnected(isConnected);
          setProvider(j?.provider ?? null);
          setEmail(j?.email ?? null);
          setMessage(String(j?.message || ""));

          // Load bots for AI (only if email feature is allowed)
          try {
            const b = await fetchJson<any>("/api/bots", { credentials: "include", cache: "no-store" });
            if (cancelled) return;

            const list = Array.isArray(b?.bots) ? b.bots : Array.isArray(b) ? b : [];
            const parsed: Bot[] = list
              .map((x: any) => ({
                id: String(x?.id || ""),
                name: String(x?.name || "Bot"),
                owner_user_id: x?.owner_user_id ?? null,
              }))
              .filter((x: Bot) => x.id);

            setBots(parsed);

            if (!botId) {
              const agency = parsed.find((x) => !x.owner_user_id) ?? parsed[0];
              if (agency?.id) setBotId(agency.id);
            }
          } catch {
            setBots([]);
          }

          // Auto-load latest threads once connected (Gmail-feel)
          if (isConnected) {
            await loadThreadsInternal(15);
          }
        }
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load inbox");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadThreadsInternal(max = 15, nextQ?: string) {
    if (!connected) return;

    setThreadsLoading(true);
    setThreadsError("");
    setThreads([]);

    try {
      const query = String(nextQ ?? qApplied ?? "").trim();
      const url = query
        ? `/api/email/threads?max=${encodeURIComponent(String(max))}&q=${encodeURIComponent(query)}`
        : `/api/email/threads?max=${encodeURIComponent(String(max))}`;

      const j = await fetchJson<any>(url, { credentials: "include", cache: "no-store" });
      const rows = Array.isArray(j?.threads) ? (j.threads as ThreadRow[]) : [];
      setThreads(rows);

      // Keep selection stable if possible
      if (!openId && rows[0]?.id) {
        await openThreadById(rows[0].id);
      }
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 409) {
          setThreadsError("Not connected. Click Connect Gmail.");
          return;
        }
      }
      setThreadsError(e?.message ?? "Failed to load threads");
    } finally {
      setThreadsLoading(false);
    }
  }

  async function loadThreads() {
    await loadThreadsInternal(15);
  }

  async function openThreadById(id: string) {
    const tid = String(id || "").trim();
    if (!tid) return;

    setOpenId(tid);
    setOpenLoading(true);
    setOpenError("");
    setOpenThread(null);

    setReplyDraftError("");
    setReplyDraftId(null);
    setReplyBody("");
    setConfirmSend(false);
    setSending(false);
    setSendError("");
    setSendOk(null);

    try {
      const j = await fetchJson<any>(`/api/email/threads/${encodeURIComponent(tid)}`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!j?.thread?.id) throw new Error("Missing thread");
      const t = j.thread as Thread;
      setOpenThread(t);

      // Seed AI with thread context once, so it feels “attached”
      setAiMsgs((prev) => {
        if (prev.length) return prev;
        return [
          {
            role: "assistant",
            text: `Thread loaded. Ask me to draft a reply like Gmail — you always review before sending.\n\nSubject: ${
              t.subject || "(no subject)"
            }`,
            at: Date.now(),
          },
        ];
      });
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 409) {
          setOpenError("Not connected. Click Connect Gmail.");
          return;
        }
      }
      setOpenError(e?.message ?? "Failed to open thread");
    } finally {
      setOpenLoading(false);
    }
  }

  async function onAiSend(msgText?: string) {
    const instruction = String(msgText ?? aiInput ?? "").trim();
    if (!instruction) return;
    if (!canUseAi || !openId) return;

    setReplyDrafting(true);
    setReplyDraftError("");
    setSendError("");
    setSendOk(null);

    setAiMsgs((prev) => [...prev, { role: "user", text: instruction, at: Date.now() }]);
    setAiInput("");

    try {
      const j = await fetchJson<any>("/api/email/reply-draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: openId,
          botId,
          instruction,
        }),
      });

      const draftId = String(j?.draftId || "").trim();
      const body = String(j?.draftBody || "").trim();

      if (!draftId || !body) {
        setReplyDraftError("Failed to generate reply draft.");
        setAiMsgs((prev) => [
          ...prev,
          { role: "assistant", text: "I couldn’t generate a draft for that. Try a simpler instruction.", at: Date.now() },
        ]);
        return;
      }

      setReplyDraftId(draftId);

      // Gmail-like: if editor empty, insert automatically; otherwise keep as suggestion in AI panel.
      setReplyBody((prev) => (prev.trim().length ? prev : body));

      setAiMsgs((prev) => [...prev, { role: "assistant", text: body, at: Date.now() }]);
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setReplyDraftError("Upgrade required to use Email inbox + replies.");
          setAiMsgs((prev) => [
            ...prev,
            { role: "assistant", text: "Email inbox + replies are Corporation-only.", at: Date.now() },
          ]);
          return;
        }
        if (e.status === 409) {
          setReplyDraftError("This bot is missing a vector store. Repair it in Bots first.");
          setAiMsgs((prev) => [
            ...prev,
            { role: "assistant", text: "That bot is missing a vector store. Repair it in Bots first.", at: Date.now() },
          ]);
          return;
        }
      }

      setReplyDraftError(e?.message ?? "Failed to generate reply draft");
      setAiMsgs((prev) => [
        ...prev,
        { role: "assistant", text: e?.message ? `Error: ${String(e.message)}` : "Drafting failed.", at: Date.now() },
      ]);
    } finally {
      setReplyDrafting(false);
    }
  }

  async function onSend() {
    if (!openId) return;

    if (!replyDraftId) {
      setSendError("Generate a draft first (AI panel), then send.");
      return;
    }

    if (!confirmSend) {
      setSendError("Confirm send to continue.");
      return;
    }

    setSending(true);
    setSendError("");
    setSendOk(null);

    try {
      const j = await fetchJson<any>("/api/email/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: replyDraftId,
          threadId: openId,
          confirm: true,
          bodyOverride: replyBody,
        }),
      });

      if (!j?.ok) {
        setSendError("Failed to send.");
        return;
      }

      setSendOk(`Sent to ${String(j?.toEmail || "recipient")}`);
      setConfirmSend(false);

      await openThreadById(openId);
      await loadThreadsInternal(15);
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setSendError("Upgrade required to send.");
          return;
        }
      }
      setSendError(e?.message ?? "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (upsell?.code) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Email inbox is available on Corporation"
          message={upsell?.message || "Upgrade to unlock the inbox + Gmail connection."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Email Inbox</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-0px)] w-full">
      <div className="flex h-full">
        {/* Gmail-like left rail */}
        <aside className="hidden w-[260px] shrink-0 border-r bg-card md:flex md:flex-col">
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold">Email</div>
              <div className="text-[11px] text-muted-foreground font-mono">{plan ?? "unknown"}</div>
            </div>

            <a
              href="/app/email"
              className="mt-3 block w-full rounded-2xl bg-foreground px-4 py-3 text-left text-sm font-semibold text-background shadow-sm hover:opacity-95"
              title="Compose"
            >
              Compose
              <div className="mt-1 text-[11px] font-normal text-background/80">AI can help write</div>
            </a>
          </div>

          <div className="px-3 pb-3">
            <div className="rounded-2xl border bg-background/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connection</div>
              {connected ? (
                <div className="mt-2 text-[12px] text-muted-foreground">
                  <div>
                    Provider: <span className="font-mono">{provider ?? "gmail"}</span>
                  </div>
                  <div className="mt-1 truncate">
                    Mailbox: <span className="font-mono">{email ?? "—"}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-[12px] text-muted-foreground">{message || "Not connected."}</div>
              )}

              <div className="mt-3 flex items-center gap-2">
                {connected ? (
                  <button
                    type="button"
                    onClick={() => loadThreads().catch(() => {})}
                    disabled={!canLoadThreads}
                    className="w-full rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    {threadsLoading ? "Loading…" : "Refresh"}
                  </button>
                ) : (
                  <a
                    href="/api/email/connect"
                    className="w-full rounded-xl bg-foreground px-3 py-2 text-center text-xs font-medium text-background"
                  >
                    Connect Gmail
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="px-3">
            <div className="rounded-2xl border bg-background/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bot</div>
              <select
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                className="mt-2 h-10 w-full rounded-xl border bg-background/40 px-3 text-sm"
                disabled={!connected}
              >
                {bots.length === 0 ? <option value="">No bots found</option> : null}
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.owner_user_id ? " (Private)" : " (Agency)"}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-[11px] text-muted-foreground">Used by AI reply drafting.</div>
            </div>
          </div>

          <nav className="flex-1 px-3 pb-4 pt-3">
            <div className="rounded-xl bg-muted px-3 py-2 text-sm font-medium">Inbox</div>
            <a className="mt-1 block rounded-xl px-3 py-2 text-sm hover:bg-muted/60" href="/app/email/drafts">
              Drafts
            </a>
          </nav>

          <div className="border-t p-3">
            <button
              type="button"
              className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-muted"
              onClick={() => setAiOpen((v) => !v)}
            >
              {aiOpen ? "Hide AI" : "Show AI"}
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex h-full flex-1 flex-col">
          {/* Top bar */}
          <header className="border-b bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="md:hidden">
                <div className="text-base font-semibold">Email</div>
                <div className="text-[11px] text-muted-foreground font-mono">{plan ?? "unknown"}</div>
              </div>

              <div className="flex flex-1 items-center gap-2">
                <div className="flex flex-1 items-center rounded-2xl border bg-background/40 px-3">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const next = String(q || "").trim();
                        setQApplied(next);
                        // backend may ignore ?q=; we still client-filter
                        loadThreadsInternal(15, next).catch(() => {});
                      }
                    }}
                    placeholder="Search mail"
                    className="h-10 w-full bg-transparent text-sm outline-none"
                    disabled={!connected}
                  />
                  <button
                    type="button"
                    className="rounded-xl px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60"
                    onClick={() => {
                      const next = String(q || "").trim();
                      setQApplied(next);
                      loadThreadsInternal(15, next).catch(() => {});
                    }}
                    disabled={!connected}
                  >
                    Search
                  </button>
                </div>

                <button
                  type="button"
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-muted md:hidden"
                  onClick={() => setAiOpen((v) => !v)}
                >
                  {aiOpen ? "Hide AI" : "Show AI"}
                </button>
              </div>
            </div>
          </header>

          {/* 3-pane */}
          <div className="flex flex-1 overflow-hidden">
            {/* Thread list */}
            <section className="w-[360px] shrink-0 border-r bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="text-sm font-semibold">Inbox</div>
                <button
                  type="button"
                  onClick={() => loadThreads().catch(() => {})}
                  disabled={!canLoadThreads}
                  className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                >
                  Reload
                </button>
              </div>

              {!connected ? (
                <div className="p-4">
                  <div className="rounded-2xl border bg-background/40 p-4 text-sm text-muted-foreground">
                    {message || "Connect Gmail to view your inbox."}
                  </div>
                  <a
                    href="/api/email/connect"
                    className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background"
                  >
                    Connect Gmail
                  </a>
                </div>
              ) : (
                <div className="flex-1 overflow-auto p-2">
                  {threadsLoading ? (
                    <div className="p-3 text-sm text-muted-foreground">Loading…</div>
                  ) : threadsError ? (
                    <div className="m-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {threadsError}
                    </div>
                  ) : filteredThreads.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No threads found.</div>
                  ) : (
                    <div className="space-y-1">
                      {filteredThreads.map((t) => {
                        const active = openId === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => openThreadById(t.id).catch(() => {})}
                            className={cx(
                              "w-full rounded-2xl border px-3 py-3 text-left transition",
                              active ? "border-primary/40 bg-primary/5" : "bg-background/40 hover:bg-muted",
                            )}
                            title={t.subject || t.last_snippet || t.id}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="truncate text-[12px] text-muted-foreground">{shortText(t.last_from || "", 48)}</div>
                              <div className="shrink-0 text-[11px] text-muted-foreground">
                                {t.messages_count ? `${t.messages_count}` : ""}
                              </div>
                            </div>
                            <div className="mt-1 truncate text-sm font-medium">{shortText(t.subject || "(no subject)", 64)}</div>
                            <div className="mt-1 truncate text-[12px] text-muted-foreground">{shortText(t.last_snippet || "", 100)}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Thread view + reply */}
            <main className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {shortText(openThread?.subject || (openId ? "Thread" : "Select a thread"), 96)}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {openId ? `thread_id: ${openId}` : connected ? "Pick a thread to read." : "Connect Gmail first."}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (openId ? openThreadById(openId) : null)}
                    disabled={!openId || openLoading}
                    className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    {openLoading ? "Loading…" : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {openError ? (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{openError}</div>
                ) : null}

                {openLoading ? (
                  <div className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">Loading thread…</div>
                ) : !openThread ? (
                  <div className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">
                    {connected ? "Select a thread." : "Connect Gmail to view your inbox."}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {openThread.messages.map((m) => (
                      <div key={m.id} className="rounded-3xl border bg-card p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">{shortText(m.from || "Unknown", 90)}</div>
                          <div className="text-xs text-muted-foreground">{m.date || ""}</div>
                        </div>
                        {m.to ? <div className="mt-1 text-[12px] text-muted-foreground">To: {shortText(m.to, 120)}</div> : null}
                        {m.snippet ? <div className="mt-2 text-sm text-muted-foreground">{m.snippet}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reply editor */}
              <div className="border-t bg-card p-4">
                <div className="mx-auto max-w-4xl">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">Reply</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                        onClick={() => setReplyBody("")}
                        disabled={!replyBody.trim().length}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 rounded-2xl border bg-background/40 p-2">
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={6}
                      className="w-full resize-none bg-transparent p-2 text-sm outline-none"
                      placeholder={openId ? "Write your reply… (or use the AI panel)" : "Select a thread first…"}
                      disabled={!openId}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmSend}
                        onChange={(e) => setConfirmSend(e.target.checked)}
                        className="h-4 w-4"
                        disabled={!openId}
                      />
                      Confirm send
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSend().catch(() => {})}
                        disabled={!openId || !replyDraftId || !confirmSend || sending}
                        className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
                        title={!replyDraftId ? "Generate a draft via AI first" : "Send reply"}
                      >
                        {sending ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </div>

                  {replyDraftError ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{replyDraftError}</div>
                  ) : null}

                  {sendError ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{sendError}</div>
                  ) : null}

                  {sendOk ? <div className="mt-3 rounded-xl border bg-muted/40 p-3 text-sm">{sendOk}</div> : null}

                  {replyDraftId ? (
                    <div className="mt-2 text-[11px] text-muted-foreground font-mono">draft_id: {replyDraftId}</div>
                  ) : null}
                </div>
              </div>
            </main>

            {/* AI panel (only visible difference) */}
            {aiOpen ? (
              <aside className="hidden w-[420px] shrink-0 border-l bg-card lg:flex lg:flex-col">
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <div className="text-sm font-semibold">AI Assistant</div>
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-xs hover:bg-muted"
                    onClick={() => setAiOpen(false)}
                  >
                    Hide
                  </button>
                </div>

                <div className="px-4 py-3">
                  <div className="rounded-2xl border bg-background/40 p-3 text-xs text-muted-foreground">
                    Gmail-like inbox. Only difference: ask AI to draft replies. You always review before sending.
                    <div className="mt-2">
                      Thread: <span className="font-mono">{openId ? shortText(openId, 52) : "none"}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canUseAi}
                      onClick={() => onAiSend("Draft a clear professional reply.")}
                      className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                    >
                      Draft reply
                    </button>
                    <button
                      type="button"
                      disabled={!canUseAi}
                      onClick={() => onAiSend("Rewrite shorter and more direct.")}
                      className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                    >
                      Shorter
                    </button>
                    <button
                      type="button"
                      disabled={!canUseAi}
                      onClick={() => onAiSend("Rewrite friendlier and warmer.")}
                      className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                    >
                      Friendlier
                    </button>
                    <button
                      type="button"
                      disabled={!canUseAi}
                      onClick={() => onAiSend("Rewrite firmer and more decisive.")}
                      className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                    >
                      Firmer
                    </button>
                  </div>
                </div>

                <div ref={aiScrollRef} className="flex-1 overflow-auto px-4 pb-4">
                  <div className="space-y-2">
                    {aiMsgs.length === 0 ? (
                      <div className="rounded-2xl border bg-background/40 p-4 text-sm text-muted-foreground">
                        Select a thread, then ask me to draft a reply.
                      </div>
                    ) : (
                      aiMsgs.map((m, idx) => (
                        <div
                          key={`${m.at}-${idx}`}
                          className={cx(
                            "rounded-2xl border p-3 text-sm whitespace-pre-wrap",
                            m.role === "user" ? "bg-background/40" : "bg-muted/30",
                          )}
                        >
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {m.role === "user" ? "You" : "Louis"}
                          </div>
                          {m.text}
                          {m.role === "assistant" && m.text.trim().length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-xl border px-3 py-2 text-xs hover:bg-muted"
                                onClick={() => setReplyBody(m.text)}
                                title="Insert into reply editor"
                              >
                                Insert into reply
                              </button>
                              <button
                                type="button"
                                className="rounded-xl border px-3 py-2 text-xs hover:bg-muted"
                                onClick={() => navigator.clipboard?.writeText(m.text).catch(() => {})}
                              >
                                Copy
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-t p-4">
                  <div className="rounded-2xl border bg-background/40 p-2">
                    <textarea
                      value={aiInput}
                      onChange={(e) => setAiInput(e.target.value)}
                      rows={3}
                      className="w-full resize-none bg-transparent p-2 text-sm outline-none"
                      placeholder={openId ? 'Ask: "Decline politely and propose next week."' : "Select a thread first…"}
                      disabled={!openId || !botId.trim().length || !connected}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          onAiSend().catch(() => {});
                        }
                      }}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">Ctrl/⌘ + Enter</div>
                    <button
                      type="button"
                      onClick={() => onAiSend().catch(() => {})}
                      disabled={!canUseAi || !aiInput.trim().length}
                      className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
                    >
                      {replyDrafting ? "Thinking…" : "Send"}
                    </button>
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}