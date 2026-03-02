// app/(app)/app/email/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type Bot = {
  id: string;
  name: string;
  owner_user_id?: string | null;
};

type Draft = { subject: string; body: string };

type DraftRow = {
  id: string;
  bot_id: string;
  subject: string;
  created_at: string;
};

type GmailThreadRow = {
  id: string;
  subject?: string;
  snippet?: string;
  from?: string;
  date?: string;
};

type GmailMessageRow = {
  id: string;
  from?: string;
  to?: string;
  date?: string;
  subject?: string;
  snippet?: string;
  body?: string;
};

type GmailThread = {
  id: string;
  subject?: string;
  messages: GmailMessageRow[];
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function shortText(s: string, max = 80) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(10, max - 12)) + "…" + t.slice(-10);
}

function safeDateLabel(s?: string) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function EmailPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const [tab, setTab] = useState<"inbox" | "drafts">("inbox");

  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState("");

  // ===== Inbox state =====
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [threads, setThreads] = useState<GmailThreadRow[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [thread, setThread] = useState<GmailThread | null>(null);

  const [replyInstruction, setReplyInstruction] = useState("");
  const [replyDrafting, setReplyDrafting] = useState(false);
  const [replyDraftError, setReplyDraftError] = useState("");
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);
  const [replyDraftBody, setReplyDraftBody] = useState<string>("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendOk, setSendOk] = useState<string | null>(null);

  // ===== Draft-from-docs state =====
  const [tone, setTone] = useState("direct");
  const [recipientName, setRecipientName] = useState("");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [prompt, setPrompt] = useState("");

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [fallback, setFallback] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [openingDraft, setOpeningDraft] = useState(false);
  const [openDraftError, setOpenDraftError] = useState("");

  const canDraft = useMemo(() => {
    return botId.trim().length > 0 && prompt.trim().length > 0 && !drafting;
  }, [botId, prompt, drafting]);

  const canReplyWithAi = useMemo(() => {
    return !!selectedThreadId && botId.trim().length > 0 && !replyDrafting;
  }, [selectedThreadId, botId, replyDrafting]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGated(false);
      setError("");

      try {
        const j = await fetchJson<any>("/api/email", { credentials: "include", cache: "no-store" });
        if (cancelled) return;

        setPlan(typeof j?.plan === "string" ? j.plan : undefined);
        setUpsell(j?.upsell ?? null);

        const allowed = Boolean(j?.ok) && !j?.upsell?.code;
        setGated(!allowed);

        if (allowed) {
          // Bots
          try {
            const b = await fetchJson<any>("/api/bots", { credentials: "include", cache: "no-store" });
            const list = Array.isArray(b?.bots) ? b.bots : Array.isArray(b) ? b : [];
            const parsed: Bot[] = list
              .map((x: any) => ({
                id: String(x?.id || ""),
                name: String(x?.name || "Bot"),
                owner_user_id: x?.owner_user_id ?? null,
              }))
              .filter((x: Bot) => x.id);

            if (cancelled) return;

            setBots(parsed);

            if (!botId) {
              const agency = parsed.find((x) => !x.owner_user_id) ?? parsed[0];
              if (agency?.id) setBotId(agency.id);
            }
          } catch {
            if (!cancelled) setBots([]);
          }

          // Recent drafts list
          try {
            setDraftsLoading(true);
            setDraftsError("");

            const d = await fetchJson<any>("/api/email/drafts", { credentials: "include", cache: "no-store" });
            if (cancelled) return;

            setDrafts(Array.isArray(d?.drafts) ? (d.drafts as DraftRow[]) : []);
          } catch (e: any) {
            if (cancelled) return;
            setDraftsError(e?.message ?? "Failed to load drafts");
          } finally {
            if (!cancelled) setDraftsLoading(false);
          }

          // Inbox threads (best-effort)
          try {
            setThreadsLoading(true);
            setThreadsError("");

            const t = await fetchJson<any>("/api/email/threads", { credentials: "include", cache: "no-store" });
            if (cancelled) return;

            const rows: GmailThreadRow[] = Array.isArray(t?.threads)
              ? t.threads.map((x: any) => ({
                  id: String(x?.id || x?.threadId || ""),
                  subject: String(x?.subject || ""),
                  snippet: String(x?.snippet || ""),
                  from: String(x?.from || ""),
                  date: String(x?.date || x?.internalDate || x?.timestamp || ""),
                }))
              : [];

            setThreads(rows.filter((r) => r.id));
            if (!selectedThreadId && rows[0]?.id) setSelectedThreadId(rows[0].id);
          } catch (e: any) {
            // If inbox endpoints aren't present yet, don't block the page.
            if (!cancelled) setThreadsError(e?.message ?? "Failed to load inbox threads");
          } finally {
            if (!cancelled) setThreadsLoading(false);
          }
        }
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load email");
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

  async function refreshDrafts() {
    try {
      const d = await fetchJson<any>("/api/email/drafts", { credentials: "include", cache: "no-store" });
      setDrafts(Array.isArray(d?.drafts) ? (d.drafts as DraftRow[]) : []);
    } catch {
      // ignore
    }
  }

  async function refreshThreads() {
    try {
      setThreadsLoading(true);
      setThreadsError("");
      const t = await fetchJson<any>("/api/email/threads", { credentials: "include", cache: "no-store" });
      const rows: GmailThreadRow[] = Array.isArray(t?.threads)
        ? t.threads.map((x: any) => ({
            id: String(x?.id || x?.threadId || ""),
            subject: String(x?.subject || ""),
            snippet: String(x?.snippet || ""),
            from: String(x?.from || ""),
            date: String(x?.date || x?.internalDate || x?.timestamp || ""),
          }))
        : [];
      setThreads(rows.filter((r) => r.id));
      if (!selectedThreadId && rows[0]?.id) setSelectedThreadId(rows[0].id);
    } catch (e: any) {
      setThreadsError(e?.message ?? "Failed to load inbox threads");
    } finally {
      setThreadsLoading(false);
    }
  }

  async function loadThread(threadId: string) {
    const id = String(threadId || "").trim();
    if (!id) return;

    setSelectedThreadId(id);
    setThreadLoading(true);
    setThreadError("");
    setThread(null);

    setReplyDraftError("");
    setReplyDraftId(null);
    setReplyDraftBody("");
    setConfirmSend(false);
    setSending(false);
    setSendError("");
    setSendOk(null);

    try {
      const j = await fetchJson<any>(`/api/email/threads/${encodeURIComponent(id)}`, {
        credentials: "include",
        cache: "no-store",
      });

      const subject = String(j?.thread?.subject || j?.subject || "").trim();
      const msgsRaw = Array.isArray(j?.thread?.messages) ? j.thread.messages : Array.isArray(j?.messages) ? j.messages : [];
      const messages: GmailMessageRow[] = msgsRaw.map((m: any) => ({
        id: String(m?.id || m?.messageId || ""),
        from: String(m?.from || ""),
        to: String(m?.to || ""),
        date: String(m?.date || m?.internalDate || m?.timestamp || ""),
        subject: String(m?.subject || ""),
        snippet: String(m?.snippet || ""),
        body: String(m?.body || m?.text || m?.plain || ""),
      }));

      setThread({
        id,
        subject: subject || (messages[messages.length - 1]?.subject || ""),
        messages: messages.filter((x) => x.id),
      });
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setThreadError(e?.message ?? "Failed to load thread");
    } finally {
      setThreadLoading(false);
    }
  }

  async function onReplyWithAi() {
    if (!canReplyWithAi || !selectedThreadId) return;

    setReplyDrafting(true);
    setReplyDraftError("");
    setReplyDraftId(null);
    setReplyDraftBody("");
    setConfirmSend(false);
    setSendError("");
    setSendOk(null);

    try {
      const j = await fetchJson<any>("/api/email/reply-draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThreadId,
          botId,
          instruction: replyInstruction || undefined,
        }),
      });

      const id = String(j?.draftId || "").trim();
      const body = String(j?.draftBody || "").trim();

      if (!id || !body) {
        setReplyDraftError("Failed to generate reply draft.");
        return;
      }

      setReplyDraftId(id);
      setReplyDraftBody(body);
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setReplyDraftError("Upgrade required to use Email inbox + replies.");
          return;
        }
        if (e.status === 400) {
          setReplyDraftError(e?.message ?? "Bad request.");
          return;
        }
        if (e.status === 404) {
          setReplyDraftError("Thread or bot not found.");
          return;
        }
      }
      setReplyDraftError(e?.message ?? "Failed to generate reply draft");
    } finally {
      setReplyDrafting(false);
    }
  }

  async function onSend() {
    if (!replyDraftId || !selectedThreadId) return;
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
          threadId: selectedThreadId,
          confirm: true,
        }),
      });

      if (!j?.ok) {
        setSendError("Failed to send.");
        return;
      }

      setSendOk(`Sent to ${String(j?.toEmail || "recipient")}`);
      setConfirmSend(false);

      // Refresh thread + threads list
      await loadThread(selectedThreadId);
      await refreshThreads();
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
        if (e.status === 400) {
          setSendError(e?.message ?? "Send blocked.");
          return;
        }
      }
      setSendError(e?.message ?? "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  async function onOpenDraft(id: string) {
    const draftId = String(id || "").trim();
    if (!draftId) return;

    setSelectedDraftId(draftId);
    setOpeningDraft(true);
    setOpenDraftError("");

    try {
      const j = await fetchJson<any>(`/api/email/drafts/${encodeURIComponent(draftId)}`, {
        credentials: "include",
        cache: "no-store",
      });

      const subj = String(j?.draft?.subject || "").trim();
      const body = String(j?.draft?.body || "").trim();

      if (!subj || !body) {
        setOpenDraftError("Could not open draft.");
        return;
      }

      setDraft({ subject: subj, body });
      setFallback(null);
      setDraftError("");
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (isFetchJsonError(e) && e.status === 404) {
        setOpenDraftError("Draft not found.");
        return;
      }
      setOpenDraftError(e?.message ?? "Failed to open draft");
    } finally {
      setOpeningDraft(false);
    }
  }

  async function onDraft() {
    if (!canDraft) return;

    setDrafting(true);
    setDraftError("");
    setFallback(null);
    setDraft(null);
    setSelectedDraftId(null);
    setOpenDraftError("");

    try {
      const j = await fetchJson<any>("/api/email/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_id: botId,
          prompt,
          tone,
          recipient: { name: recipientName, company: recipientCompany },
        }),
      });

      if (j?.fallback) {
        setFallback(String(j?.message || "I don’t have that information in the docs yet."));
        return;
      }

      if (!j?.draft?.subject || !j?.draft?.body) {
        setFallback("I don’t have that information in the docs yet.");
        return;
      }

      setDraft({ subject: String(j.draft.subject), body: String(j.draft.body) });

      await refreshDrafts();
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setDraftError("Upgrade required to use Email drafting.");
          return;
        }
        if (e.status === 409) {
          setDraftError("This bot is missing a vector store. Repair it in Bots first.");
          return;
        }
      }
      setDraftError(e?.message ?? "Failed to draft email");
    } finally {
      setDrafting(false);
    }
  }

  useEffect(() => {
    if (!gated && selectedThreadId && tab === "inbox") {
      // best-effort load selected thread when tab is inbox
      loadThread(selectedThreadId).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [tab]);

  if (loading) return <div className="p-6">Loading...</div>;

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Email is available on Corporation"
          message={upsell?.message || "Upgrade to unlock the email inbox + docs-backed drafting."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Email</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Email</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan: <span className="font-mono">{plan ?? "unknown"}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border bg-card p-2 shadow-sm">
          <button
            type="button"
            onClick={() => setTab("inbox")}
            className={[
              "rounded-xl px-3 py-2 text-sm font-medium transition",
              tab === "inbox" ? "bg-foreground text-background" : "hover:bg-muted",
            ].join(" ")}
          >
            Inbox
          </button>
          <button
            type="button"
            onClick={() => setTab("drafts")}
            className={[
              "rounded-xl px-3 py-2 text-sm font-medium transition",
              tab === "drafts" ? "bg-foreground text-background" : "hover:bg-muted",
            ].join(" ")}
          >
            Draft from docs
          </button>
        </div>
      </div>

      {/* Shared: bot selector */}
      <div className="rounded-3xl border bg-card p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-sm font-medium">Bot</div>
            <select
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
            >
              {bots.length === 0 ? <option value="">No bots found</option> : null}
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.owner_user_id ? " (Private)" : " (Agency)"}
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">
              Inbox replies and drafting use this bot’s vector store for file_search.
            </div>
          </div>

          <div className="flex items-end justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                refreshThreads().catch(() => {});
                refreshDrafts().catch(() => {});
              }}
              className="h-11 rounded-xl border px-4 text-sm hover:bg-muted"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {tab === "inbox" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Threads list */}
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold">Inbox</div>
              <button
                type="button"
                onClick={() => refreshThreads().catch(() => {})}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
              >
                Reload
              </button>
            </div>

            {threadsLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : threadsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{threadsError}</div>
            ) : threads.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No threads found (or inbox endpoints not wired).
              </div>
            ) : (
              <div className="space-y-2">
                {threads.slice(0, 30).map((t) => {
                  const active = selectedThreadId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => loadThread(t.id)}
                      className={[
                        "w-full text-left rounded-xl border bg-background/40 p-3 transition",
                        active ? "border-primary/40 bg-primary/5" : "hover:bg-muted",
                      ].join(" ")}
                      title={t.subject || t.snippet || t.id}
                    >
                      <div className="text-xs text-muted-foreground">{safeDateLabel(t.date) || "—"}</div>
                      <div className="mt-1 text-sm font-medium">{shortText(t.subject || "(no subject)", 72)}</div>
                      <div className="mt-1 text-[12px] text-muted-foreground">{shortText(t.from || "", 72)}</div>
                      <div className="mt-1 text-[12px] text-muted-foreground">{shortText(t.snippet || "", 96)}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground font-mono">{t.id}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Thread view + reply */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">Thread</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Reply drafting uses thread context + file_search (bot docs). Strict fallback only when internal + no evidence.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => (selectedThreadId ? loadThread(selectedThreadId) : null)}
                  disabled={!selectedThreadId || threadLoading}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                >
                  {threadLoading ? "Loading…" : "Refresh thread"}
                </button>
              </div>

              {threadError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{threadError}</div>
              ) : null}

              {!selectedThreadId ? (
                <div className="text-sm text-muted-foreground">Select a thread to view.</div>
              ) : threadLoading ? (
                <div className="text-sm text-muted-foreground">Loading thread…</div>
              ) : thread ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border bg-background/40 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</div>
                    <div className="mt-1 text-sm">{thread.subject || "(no subject)"}</div>
                    <div className="mt-2 text-[11px] text-muted-foreground font-mono">{thread.id}</div>
                  </div>

                  <div className="space-y-3">
                    {thread.messages.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No messages.</div>
                    ) : (
                      thread.messages.map((m) => (
                        <div key={m.id} className="rounded-2xl border bg-background/40 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium">{shortText(m.from || "Unknown", 80)}</div>
                            <div className="text-xs text-muted-foreground">{safeDateLabel(m.date) || "—"}</div>
                          </div>
                          {m.snippet ? (
                            <div className="mt-2 text-sm text-muted-foreground">{shortText(m.snippet, 180)}</div>
                          ) : null}
                          {m.body ? (
                            <div className="mt-3 whitespace-pre-wrap text-sm">{m.body}</div>
                          ) : null}
                          <div className="mt-3 text-[11px] text-muted-foreground font-mono">{m.id}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No thread loaded.</div>
              )}
            </div>

            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">Reply with AI</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Generates a reply draft from thread context + docs. You can edit before sending.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onReplyWithAi}
                  disabled={!canReplyWithAi}
                  className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
                >
                  {replyDrafting ? "Drafting…" : "Reply with AI"}
                </button>
              </div>

              <div>
                <div className="text-sm font-medium">Instruction (optional)</div>
                <input
                  value={replyInstruction}
                  onChange={(e) => setReplyInstruction(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  placeholder='Example: "Be friendly, ask for a quick call this week."'
                />
              </div>

              {replyDraftError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{replyDraftError}</div>
              ) : null}

              {replyDraftId ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">Draft reply</div>
                    <button
                      type="button"
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => navigator.clipboard?.writeText(replyDraftBody).catch(() => {})}
                    >
                      Copy
                    </button>
                  </div>

                  <textarea
                    value={replyDraftBody}
                    onChange={(e) => setReplyDraftBody(e.target.value)}
                    rows={10}
                    className="w-full rounded-xl border bg-background/40 p-3 text-sm whitespace-pre-wrap"
                    placeholder="Draft will appear here…"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={confirmSend}
                        onChange={(e) => setConfirmSend(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Confirm send (required)
                    </label>

                    <button
                      type="button"
                      onClick={onSend}
                      disabled={!confirmSend || sending}
                      className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
                    >
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </div>

                  {sendError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{sendError}</div>
                  ) : null}

                  {sendOk ? (
                    <div className="rounded-xl border bg-muted/40 p-3 text-sm">{sendOk}</div>
                  ) : null}

                  <div className="text-[11px] text-muted-foreground font-mono">
                    draft_id: {replyDraftId}
                    {selectedThreadId ? ` • thread_id: ${selectedThreadId}` : ""}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Generate a reply draft first. Sending requires explicit confirmation.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
              <div>
                <div className="text-base font-semibold">Draft from docs</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Louis will only draft internal facts from docs. If file_search finds no evidence for an internal claim, you get the fallback.
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-sm font-medium">Tone</div>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  >
                    <option value="friendly">friendly</option>
                    <option value="direct">direct</option>
                    <option value="formal">formal</option>
                  </select>
                  <div className="mt-2 text-xs text-muted-foreground">Controls voice. Facts still must come from docs.</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-sm font-medium">Recipient name (optional)</div>
                  <input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                    placeholder="Jamie"
                  />
                </div>
                <div>
                  <div className="text-sm font-medium">Recipient company (optional)</div>
                  <input
                    value={recipientCompany}
                    onChange={(e) => setRecipientCompany(e.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                    placeholder="Acme Co"
                  />
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">What email do you need?</div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
                  placeholder='Example: "Draft a follow-up to the client about the onboarding kickoff. Use our onboarding SOP + timeline."'
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onDraft}
                  disabled={!canDraft}
                  className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
                >
                  {drafting ? "Drafting..." : "Draft email"}
                </button>

                <div className="text-xs text-muted-foreground">Strict docs-backed for internal facts.</div>
              </div>

              {draftError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{draftError}</div>
              ) : null}

              {fallback ? <div className="rounded-xl border bg-muted/40 p-3 text-sm font-mono">{fallback}</div> : null}

              {draft ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      Draft {selectedDraftId ? <span className="text-xs text-muted-foreground">(opened)</span> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                        onClick={() => navigator.clipboard?.writeText(draft.subject).catch(() => {})}
                      >
                        Copy subject
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                        onClick={() => navigator.clipboard?.writeText(draft.body).catch(() => {})}
                      >
                        Copy body
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-background/40 p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</div>
                    <div className="mt-1">{draft.subject}</div>
                  </div>

                  <div className="rounded-xl border bg-background/40 p-3 text-sm whitespace-pre-wrap">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Body</div>
                    <div className="mt-2">{draft.body}</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-3">
              <div className="text-base font-semibold">Recent drafts</div>

              {draftsLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : draftsError ? (
                <div className="text-sm text-red-600">{draftsError}</div>
              ) : drafts.length === 0 ? (
                <div className="text-sm text-muted-foreground">No drafts yet.</div>
              ) : (
                <div className="space-y-2">
                  {openDraftError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {openDraftError}
                    </div>
                  ) : null}

                  {drafts.slice(0, 12).map((d) => {
                    const active = selectedDraftId === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => onOpenDraft(d.id)}
                        disabled={openingDraft && active}
                        className={[
                          "w-full text-left rounded-xl border bg-background/40 p-3 transition",
                          active ? "border-primary/40 bg-primary/5" : "hover:bg-muted",
                        ].join(" ")}
                        title={d.subject}
                      >
                        <div className="text-xs text-muted-foreground">
                          {new Date(d.created_at).toLocaleString()}
                          {active && openingDraft ? " • Opening…" : ""}
                        </div>
                        <div className="mt-1 text-sm font-medium">{shortText(d.subject, 72)}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground font-mono">{d.id}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Inbox replies: thread context + docs (file_search) + strict fallback only for internal/no-evidence.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}