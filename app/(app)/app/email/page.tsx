// app/(app)/app/email/page.tsx
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

type AiChatMsg = {
  role: "user" | "assistant";
  text: string;
  at: number;
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

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function EmailPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  // Gmail-like nav: Inbox / Drafts / Compose / Docs Draft
  const [tab, setTab] = useState<"inbox" | "drafts" | "compose" | "docs-draft">("inbox");

  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState("");

  // ===== Top search =====
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");

  // ===== Inbox state =====
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [threads, setThreads] = useState<GmailThreadRow[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [thread, setThread] = useState<GmailThread | null>(null);

  // ===== Reply / send =====
  const [replyDrafting, setReplyDrafting] = useState(false);
  const [replyDraftError, setReplyDraftError] = useState("");
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);

  // Reply editor content
  const [replyBody, setReplyBody] = useState<string>("");

  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendOk, setSendOk] = useState<string | null>(null);

  // ===== Compose (new email) =====
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeConfirm, setComposeConfirm] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [composeOk, setComposeOk] = useState<string | null>(null);

  // ===== AI drawer (not a column) =====
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMsgs, setAiMsgs] = useState<AiChatMsg[]>([]);
  const [aiInput, setAiInput] = useState("");
  const aiScrollRef = useRef<HTMLDivElement | null>(null);

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

  const canComposeSend = useMemo(() => {
    const toOk = composeTo.trim().length > 0;
    const bodyOk = composeBody.trim().length > 0;
    const ok = toOk && bodyOk && composeConfirm && !composeSending;
    return ok;
  }, [composeTo, composeBody, composeConfirm, composeSending]);

  useEffect(() => {
    if (!aiScrollRef.current) return;
    aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight;
  }, [aiMsgs, aiOpen]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGated(false);
      setError("");

      try {
        const j = await fetchJson<any>("/api/email", {
          credentials: "include",
          cache: "no-store",
        });
        if (cancelled) return;

        setPlan(typeof j?.plan === "string" ? j.plan : undefined);
        setUpsell(j?.upsell ?? null);

        const allowed = Boolean(j?.ok) && !j?.upsell?.code;
        setGated(!allowed);

        if (allowed) {
          try {
            const b = await fetchJson<any>("/api/bots", {
              credentials: "include",
              cache: "no-store",
            });

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

          try {
            setDraftsLoading(true);
            setDraftsError("");

            const d = await fetchJson<any>("/api/email/drafts", {
              credentials: "include",
              cache: "no-store",
            });
            if (cancelled) return;

            setDrafts(Array.isArray(d?.drafts) ? (d.drafts as DraftRow[]) : []);
          } catch (e: any) {
            if (cancelled) return;
            setDraftsError(e?.message ?? "Failed to load drafts");
          } finally {
            if (!cancelled) setDraftsLoading(false);
          }

          // inbox list
          try {
            setThreadsLoading(true);
            setThreadsError("");

            const t = await fetchJson<any>("/api/email/threads", {
              credentials: "include",
              cache: "no-store",
            });
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

            const cleaned = rows.filter((r) => r.id);
            setThreads(cleaned);
            if (!selectedThreadId && cleaned[0]?.id) setSelectedThreadId(cleaned[0].id);
          } catch (e: any) {
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
      const d = await fetchJson<any>("/api/email/drafts", {
        credentials: "include",
        cache: "no-store",
      });
      setDrafts(Array.isArray(d?.drafts) ? (d.drafts as DraftRow[]) : []);
    } catch {
      // ignore
    }
  }

  async function refreshThreads(nextQ?: string) {
    try {
      setThreadsLoading(true);
      setThreadsError("");

      const query = String(nextQ ?? qApplied ?? "").trim();
      const url = query ? `/api/email/threads?q=${encodeURIComponent(query)}` : "/api/email/threads";

      const t = await fetchJson<any>(url, { credentials: "include", cache: "no-store" });
      const rows: GmailThreadRow[] = Array.isArray(t?.threads)
        ? t.threads.map((x: any) => ({
            id: String(x?.id || x?.threadId || ""),
            subject: String(x?.subject || ""),
            snippet: String(x?.snippet || ""),
            from: String(x?.from || ""),
            date: String(x?.date || x?.internalDate || x?.timestamp || ""),
          }))
        : [];

      const cleaned = rows.filter((r) => r.id);

      const filtered =
        query && cleaned.length
          ? cleaned.filter((r) => {
              const hay = `${r.subject || ""} ${r.from || ""} ${r.snippet || ""}`.toLowerCase();
              return hay.includes(query.toLowerCase());
            })
          : cleaned;

      setThreads(filtered);
      if (!selectedThreadId && filtered[0]?.id) setSelectedThreadId(filtered[0].id);
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
    setReplyBody("");
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
      const msgsRaw = Array.isArray(j?.thread?.messages)
        ? j.thread.messages
        : Array.isArray(j?.messages)
          ? j.messages
          : [];

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

      setAiMsgs((prev) => {
        if (prev.length) return prev;
        const s = subject || (messages[messages.length - 1]?.subject || "");
        return [
          {
            role: "assistant",
            text: `Thread loaded. Ask me to draft a reply, rewrite tone, or summarize.\n\nSubject: ${s || "(no subject)"}`,
            at: Date.now(),
          },
        ];
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

  async function onAiSend(msgText?: string) {
    const instruction = String(msgText ?? aiInput ?? "").trim();
    if (!instruction) return;
    if (!canReplyWithAi || !selectedThreadId) return;

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
          threadId: selectedThreadId,
          botId,
          instruction,
        }),
      });

      const id = String(j?.draftId || "").trim();
      const body = String(j?.draftBody || "").trim();

      if (!id || !body) {
        setReplyDraftError("Failed to generate reply draft.");
        setAiMsgs((prev) => [
          ...prev,
          { role: "assistant", text: "I couldn’t generate a draft. Try a simpler instruction.", at: Date.now() },
        ]);
        return;
      }

      setReplyDraftId(id);
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
            { role: "assistant", text: "Email is locked to Corporation. Upgrade to continue.", at: Date.now() },
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
        { role: "assistant", text: e?.message ? `Error: ${String(e.message)}` : "Something went wrong.", at: Date.now() },
      ]);
    } finally {
      setReplyDrafting(false);
    }
  }

  async function onSendReply() {
    if (!replyDraftId || !selectedThreadId) {
      setSendError("Generate a draft first (AI), then send.");
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
          threadId: selectedThreadId,
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
      }
      setSendError(e?.message ?? "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  async function onSendCompose() {
    setComposeError("");
    setComposeOk(null);

    const to = composeTo.trim();
    const cc = composeCc.trim();
    const bcc = composeBcc.trim();
    const subject = composeSubject.trim();
    const body = composeBody.trim();

    if (!to) {
      setComposeError("Missing To.");
      return;
    }
    if (!body) {
      setComposeError("Empty email body.");
      return;
    }
    if (!composeConfirm) {
      setComposeError("Confirm send to continue.");
      return;
    }

    setComposeSending(true);

    try {
      const j = await fetchJson<any>("/api/email/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          subject,
          body,
          confirm: true,
        }),
      });

      if (!j?.ok) {
        setComposeError("Failed to send.");
        return;
      }

      setComposeOk(`Sent to ${String(j?.toEmail || to)}`);
      setComposeConfirm(false);

      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject("");
      setComposeBody("");

      await refreshThreads();
      setTab("inbox");
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setComposeError("Upgrade required to send.");
          return;
        }
      }
      setComposeError(e?.message ?? "Failed to send email");
    } finally {
      setComposeSending(false);
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

  async function onDraftFromDocs() {
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

      const next = { subject: String(j.draft.subject), body: String(j.draft.body) };
      setDraft(next);

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

  function moveDraftIntoCompose() {
    if (!draft) return;
    setComposeSubject(draft.subject || "");
    setComposeBody(draft.body || "");
    setComposeError("");
    setComposeOk(null);
    setComposeConfirm(false);
    setTab("compose");
  }

  useEffect(() => {
    if (!gated && selectedThreadId && tab === "inbox") {
      loadThread(selectedThreadId).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [tab]);

  if (loading) return <div className="p-6">Loading…</div>;

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

  const activeThread = threads.find((t) => t.id === selectedThreadId) || null;

  const showThreadsColumn = tab === "inbox" || tab === "drafts";
  const showReadingPane = tab === "inbox" || tab === "drafts";
  const showReplyBar = tab === "inbox";

  return (
    <div className="h-[calc(100vh-0px)] w-full bg-background text-foreground">
      <div className="flex h-full">
        {/* Email left rail (Gmail-ish) */}
        <aside className="hidden w-[280px] shrink-0 border-r bg-background md:flex md:flex-col">
          <div className="px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold">Email</div>
              <div className="text-[11px] text-muted-foreground font-mono">{plan ?? "unknown"}</div>
            </div>

            <button
              type="button"
              onClick={() => setTab("compose")}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background hover:opacity-95"
            >
              Compose
            </button>

            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bot</div>
              <select
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
              >
                {bots.length === 0 ? <option value="">No bots found</option> : null}
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.owner_user_id ? " (Private)" : " (Agency)"}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-[11px] text-muted-foreground">Used for inbox AI + docs drafting.</div>
            </div>
          </div>

          <nav className="px-2 pb-3">
            <button
              type="button"
              onClick={() => setTab("inbox")}
              className={cx(
                "w-full rounded-lg px-3 py-2 text-left text-sm",
                tab === "inbox" ? "bg-muted font-medium" : "hover:bg-muted/60",
              )}
            >
              Inbox
            </button>
            <button
              type="button"
              onClick={() => setTab("drafts")}
              className={cx(
                "mt-1 w-full rounded-lg px-3 py-2 text-left text-sm",
                tab === "drafts" ? "bg-muted font-medium" : "hover:bg-muted/60",
              )}
            >
              Drafts
            </button>
            <button
              type="button"
              onClick={() => setTab("docs-draft")}
              className={cx(
                "mt-1 w-full rounded-lg px-3 py-2 text-left text-sm",
                tab === "docs-draft" ? "bg-muted font-medium" : "hover:bg-muted/60",
              )}
            >
              Draft from docs
            </button>
          </nav>

          <div className="mt-auto border-t p-3">
            <button
              type="button"
              onClick={() => {
                refreshThreads().catch(() => {});
                refreshDrafts().catch(() => {});
              }}
              className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-muted"
            >
              Refresh
            </button>
          </div>
        </aside>

        {/* Main app surface */}
        <div className="flex h-full flex-1 flex-col">
          {/* Top search bar (flat, like Gmail) */}
          <header className="border-b bg-background px-3 py-3">
            <div className="flex items-center gap-2">
              <div className="md:hidden">
                <div className="text-base font-semibold">Email</div>
                <div className="text-[11px] text-muted-foreground font-mono">{plan ?? "unknown"}</div>
              </div>

              <div className="flex flex-1 items-center gap-2">
                <div className="flex flex-1 items-center rounded-full border bg-background px-4">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const next = String(q || "").trim();
                        setQApplied(next);
                        refreshThreads(next).catch(() => {});
                      }
                    }}
                    placeholder="Search mail"
                    className="h-10 w-full bg-transparent text-sm outline-none"
                  />
                  <button
                    type="button"
                    className="ml-2 rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      const next = String(q || "").trim();
                      setQApplied(next);
                      refreshThreads(next).catch(() => {});
                    }}
                    title="Search"
                  >
                    Search
                  </button>
                </div>

                <button
                  type="button"
                  className={cx(
                    "hidden items-center rounded-full border px-4 py-2 text-sm hover:bg-muted md:inline-flex",
                    tab === "inbox" ? "md:inline-flex" : "md:hidden",
                  )}
                  onClick={() => setAiOpen(true)}
                  title="Open AI assistant"
                >
                  AI
                </button>
              </div>
            </div>
          </header>

          {/* Content columns */}
          <div className="flex flex-1 overflow-hidden">
            {/* Threads / Drafts list column */}
            {showThreadsColumn ? (
              <section className="w-[420px] shrink-0 border-r bg-background">
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <div className="text-sm font-semibold">{tab === "drafts" ? "Drafts" : "Threads"}</div>
                  <button
                    type="button"
                    onClick={() => (tab === "drafts" ? refreshDrafts() : refreshThreads()).catch(() => {})}
                    className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    Reload
                  </button>
                </div>

                <div className="h-full overflow-auto">
                  {tab === "inbox" ? (
                    <div className="px-1 py-1">
                      {threadsLoading ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                      ) : threadsError ? (
                        <div className="m-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                          {threadsError}
                        </div>
                      ) : threads.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">No threads found.</div>
                      ) : (
                        <div>
                          {threads.slice(0, 80).map((t) => {
                            const active = selectedThreadId === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setTab("inbox");
                                  loadThread(t.id).catch(() => {});
                                }}
                                className={cx(
                                  "w-full px-4 py-3 text-left transition",
                                  active ? "bg-muted" : "hover:bg-muted/60",
                                )}
                                title={t.subject || t.snippet || t.id}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="truncate text-[12px] text-muted-foreground">
                                    {shortText(t.from || "", 56)}
                                  </div>
                                  <div className="shrink-0 text-[11px] text-muted-foreground">
                                    {safeDateLabel(t.date) || ""}
                                  </div>
                                </div>
                                <div className="mt-1 truncate text-sm font-medium">
                                  {shortText(t.subject || "(no subject)", 72)}
                                </div>
                                <div className="mt-1 truncate text-[12px] text-muted-foreground">
                                  {shortText(t.snippet || "", 110)}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="px-1 py-1">
                      {draftsLoading ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                      ) : draftsError ? (
                        <div className="m-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                          {draftsError}
                        </div>
                      ) : drafts.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">No drafts yet.</div>
                      ) : (
                        <div>
                          {openDraftError ? (
                            <div className="m-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                              {openDraftError}
                            </div>
                          ) : null}

                          {drafts.slice(0, 80).map((d) => {
                            const active = selectedDraftId === d.id;
                            return (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => onOpenDraft(d.id).catch(() => {})}
                                disabled={openingDraft && active}
                                className={cx(
                                  "w-full px-4 py-3 text-left transition",
                                  active ? "bg-muted" : "hover:bg-muted/60",
                                )}
                                title={d.subject}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="truncate text-[12px] text-muted-foreground">Draft</div>
                                  <div className="shrink-0 text-[11px] text-muted-foreground">
                                    {new Date(d.created_at).toLocaleString()}
                                  </div>
                                </div>
                                <div className="mt-1 truncate text-sm font-medium">
                                  {shortText(d.subject || "(no subject)", 80)}
                                </div>
                                <div className="mt-1 truncate text-[11px] font-mono text-muted-foreground">{shortText(d.id, 54)}</div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {/* Reading pane / compose pane */}
            <main className="flex flex-1 flex-col overflow-hidden bg-background">
              {tab === "compose" ? (
                <div className="h-full overflow-auto">
                  <div className="mx-auto max-w-3xl px-6 py-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">Compose</div>
                        <div className="mt-1 text-sm text-muted-foreground">Send a new email.</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTab("docs-draft")}
                          className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                        >
                          Draft from docs
                        </button>
                        <button
                          type="button"
                          onClick={() => setTab("inbox")}
                          className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                        >
                          Back
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-sm font-medium">To</div>
                          <input
                            value={composeTo}
                            onChange={(e) => setComposeTo(e.target.value)}
                            className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                            placeholder="name@company.com"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-sm font-medium">Cc</div>
                            <input
                              value={composeCc}
                              onChange={(e) => setComposeCc(e.target.value)}
                              className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                              placeholder="optional"
                            />
                          </div>
                          <div>
                            <div className="text-sm font-medium">Bcc</div>
                            <input
                              value={composeBcc}
                              onChange={(e) => setComposeBcc(e.target.value)}
                              className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                              placeholder="optional"
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-medium">Subject</div>
                        <input
                          value={composeSubject}
                          onChange={(e) => setComposeSubject(e.target.value)}
                          className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                          placeholder="(no subject)"
                        />
                      </div>

                      <div>
                        <div className="text-sm font-medium">Message</div>
                        <textarea
                          value={composeBody}
                          onChange={(e) => setComposeBody(e.target.value)}
                          rows={14}
                          className="mt-2 w-full rounded-lg border bg-background p-3 text-sm outline-none"
                          placeholder="Write your email…"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={composeConfirm}
                            onChange={(e) => setComposeConfirm(e.target.checked)}
                            className="h-4 w-4"
                          />
                          Confirm send
                        </label>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setComposeTo("");
                              setComposeCc("");
                              setComposeBcc("");
                              setComposeSubject("");
                              setComposeBody("");
                              setComposeError("");
                              setComposeOk(null);
                              setComposeConfirm(false);
                            }}
                            className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                            disabled={composeSending}
                          >
                            Clear
                          </button>

                          <button
                            type="button"
                            onClick={() => onSendCompose().catch(() => {})}
                            disabled={!canComposeSend}
                            className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-60"
                          >
                            {composeSending ? "Sending…" : "Send"}
                          </button>
                        </div>
                      </div>

                      {composeError ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{composeError}</div>
                      ) : null}

                      {composeOk ? <div className="rounded-lg border bg-muted/30 p-3 text-sm">{composeOk}</div> : null}
                    </div>
                  </div>
                </div>
              ) : tab === "docs-draft" ? (
                <div className="h-full overflow-auto">
                  <div className="mx-auto max-w-3xl px-6 py-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">Draft from docs</div>
                        <div className="mt-1 text-sm text-muted-foreground">Generates content using file_search evidence.</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTab("compose")}
                          className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                        >
                          Back to compose
                        </button>
                        <button
                          type="button"
                          onClick={() => setTab("inbox")}
                          className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                        >
                          Back
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-sm font-medium">Tone</div>
                          <select
                            value={tone}
                            onChange={(e) => setTone(e.target.value)}
                            className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                          >
                            <option value="friendly">friendly</option>
                            <option value="direct">direct</option>
                            <option value="formal">formal</option>
                          </select>
                        </div>

                        <div className="flex items-end justify-end">
                          <button
                            type="button"
                            onClick={() => onDraftFromDocs().catch(() => {})}
                            disabled={!canDraft}
                            className="h-11 rounded-full bg-foreground px-5 text-sm font-medium text-background disabled:opacity-60"
                          >
                            {drafting ? "Drafting…" : "Generate"}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-sm font-medium">Recipient name (optional)</div>
                          <input
                            value={recipientName}
                            onChange={(e) => setRecipientName(e.target.value)}
                            className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                            placeholder="Jamie"
                          />
                        </div>
                        <div>
                          <div className="text-sm font-medium">Recipient company (optional)</div>
                          <input
                            value={recipientCompany}
                            onChange={(e) => setRecipientCompany(e.target.value)}
                            className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                            placeholder="Acme Co"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-medium">What email do you need?</div>
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          rows={7}
                          className="mt-2 w-full rounded-lg border bg-background p-3 text-sm outline-none"
                          placeholder='Example: "Draft a follow-up about the onboarding kickoff. Use our onboarding SOP + timeline."'
                        />
                        <div className="mt-2 text-xs text-muted-foreground">
                          Facts must come from docs; general writing is allowed.
                        </div>
                      </div>

                      {draftError ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{draftError}</div>
                      ) : null}

                      {fallback ? <div className="rounded-lg border bg-muted/30 p-3 text-sm font-mono">{fallback}</div> : null}

                      {draft ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold">Draft</div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                                onClick={moveDraftIntoCompose}
                                title="Move into compose editor"
                              >
                                Use in compose
                              </button>
                              <button
                                type="button"
                                className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                                onClick={() => navigator.clipboard?.writeText(draft.subject).catch(() => {})}
                              >
                                Copy subject
                              </button>
                              <button
                                type="button"
                                className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                                onClick={() => navigator.clipboard?.writeText(draft.body).catch(() => {})}
                              >
                                Copy body
                              </button>
                            </div>
                          </div>

                          <div className="rounded-lg border bg-background p-3 text-sm">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Subject
                            </div>
                            <div className="mt-1">{draft.subject}</div>
                          </div>

                          <div className="rounded-lg border bg-background p-3 text-sm whitespace-pre-wrap">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Body
                            </div>
                            <div className="mt-2">{draft.body}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : tab === "drafts" ? (
                <div className="flex h-full flex-col">
                  <div className="border-b px-4 py-3">
                    <div className="text-sm font-semibold">{draft?.subject ? shortText(draft.subject, 90) : "Draft"}</div>
                    <div className="mt-1 text-[12px] text-muted-foreground">Select a draft from the list.</div>
                  </div>

                  <div className="flex-1 overflow-auto p-4">
                    {draft ? (
                      <div className="mx-auto max-w-3xl">
                        <div className="mb-3 flex items-center justify-end">
                          <button
                            type="button"
                            className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                            onClick={() => {
                              setComposeSubject(draft.subject || "");
                              setComposeBody(draft.body || "");
                              setComposeError("");
                              setComposeOk(null);
                              setComposeConfirm(false);
                              setTab("compose");
                            }}
                          >
                            Use in compose
                          </button>
                        </div>
                        <div className="whitespace-pre-wrap text-sm leading-6">{draft.body}</div>
                      </div>
                    ) : (
                      <div className="p-4 text-sm text-muted-foreground">Pick a draft to preview.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  {/* Reading pane header */}
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {shortText(thread?.subject || activeThread?.subject || "Select a thread", 96)}
                      </div>
                      <div className="mt-1 truncate text-[12px] text-muted-foreground">
                        {selectedThreadId ? shortText(activeThread?.from || "", 80) : "Pick a thread from the left."}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => (selectedThreadId ? loadThread(selectedThreadId) : null)}
                        disabled={!selectedThreadId || threadLoading}
                        className="rounded-full border px-4 py-2 text-xs hover:bg-muted disabled:opacity-60"
                      >
                        {threadLoading ? "Loading…" : "Refresh"}
                      </button>

                      <button
                        type="button"
                        className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
                        onClick={() => setAiOpen(true)}
                        disabled={!selectedThreadId || !botId.trim().length}
                        title={!selectedThreadId ? "Select a thread first" : "Open AI assistant"}
                      >
                        AI
                      </button>
                    </div>
                  </div>

                  {/* Reading pane body */}
                  <div className="flex-1 overflow-auto">
                    {threadError ? (
                      <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{threadError}</div>
                    ) : null}

                    {!selectedThreadId ? (
                      <div className="p-6 text-sm text-muted-foreground">Select a thread to view.</div>
                    ) : threadLoading ? (
                      <div className="p-6 text-sm text-muted-foreground">Loading thread…</div>
                    ) : thread ? (
                      <div>
                        {thread.messages.length === 0 ? (
                          <div className="p-6 text-sm text-muted-foreground">No messages.</div>
                        ) : (
                          thread.messages.map((m) => (
                            <div key={m.id} className="border-b px-6 py-5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-medium">{shortText(m.from || "Unknown", 110)}</div>
                                <div className="text-xs text-muted-foreground">{safeDateLabel(m.date) || "—"}</div>
                              </div>
                              {m.to ? (
                                <div className="mt-1 text-[12px] text-muted-foreground">
                                  To: {shortText(m.to, 140)}
                                </div>
                              ) : null}
                              {m.snippet ? (
                                <div className="mt-2 text-sm text-muted-foreground">{shortText(m.snippet, 260)}</div>
                              ) : null}
                              {m.body ? <div className="mt-3 whitespace-pre-wrap text-sm leading-6">{m.body}</div> : null}
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="p-6 text-sm text-muted-foreground">No thread loaded.</div>
                    )}
                  </div>

                  {/* Reply bar (clean, Gmail-ish) */}
                  {showReplyBar ? (
                    <div className="border-t bg-background px-4 py-3">
                      <div className="mx-auto max-w-4xl">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">Reply</div>
                          <button
                            type="button"
                            className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
                            onClick={() => setReplyBody("")}
                            disabled={!replyBody.trim().length}
                          >
                            Clear
                          </button>
                        </div>

                        <div className="mt-2 rounded-lg border bg-background">
                          <textarea
                            value={replyBody}
                            onChange={(e) => setReplyBody(e.target.value)}
                            rows={5}
                            className="w-full resize-none bg-transparent p-3 text-sm outline-none"
                            placeholder={selectedThreadId ? "Write your reply… (or open AI)" : "Select a thread first…"}
                            disabled={!selectedThreadId}
                          />
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={confirmSend}
                              onChange={(e) => setConfirmSend(e.target.checked)}
                              className="h-4 w-4"
                            />
                            Confirm send
                          </label>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onSendReply().catch(() => {})}
                              disabled={!selectedThreadId || !replyDraftId || !confirmSend || sending}
                              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-60"
                              title={!replyDraftId ? "Generate a draft via AI first" : "Send reply"}
                            >
                              {sending ? "Sending…" : "Send"}
                            </button>
                          </div>
                        </div>

                        {replyDraftError ? (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            {replyDraftError}
                          </div>
                        ) : null}

                        {sendError ? (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            {sendError}
                          </div>
                        ) : null}

                        {sendOk ? <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-sm">{sendOk}</div> : null}

                        {replyDraftId ? (
                          <div className="mt-2 text-[11px] text-muted-foreground font-mono">draft_id: {replyDraftId}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </main>
          </div>

          {/* Mobile bottom nav */}
          <div className="border-t bg-background p-3 md:hidden">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setTab("inbox")}
                className={cx("rounded-lg border px-3 py-2 text-sm", tab === "inbox" ? "bg-muted font-medium" : "hover:bg-muted")}
              >
                Inbox
              </button>
              <button
                type="button"
                onClick={() => setTab("drafts")}
                className={cx("rounded-lg border px-3 py-2 text-sm", tab === "drafts" ? "bg-muted font-medium" : "hover:bg-muted")}
              >
                Drafts
              </button>
              <button
                type="button"
                onClick={() => setTab("compose")}
                className={cx("rounded-lg border px-3 py-2 text-sm", tab === "compose" ? "bg-muted font-medium" : "hover:bg-muted")}
              >
                Compose
              </button>
              <button
                type="button"
                onClick={() => setTab("docs-draft")}
                className={cx("rounded-lg border px-3 py-2 text-sm", tab === "docs-draft" ? "bg-muted font-medium" : "hover:bg-muted")}
              >
                Docs
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Drawer (slide-over) */}
      {aiOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAiOpen(false)} />
          <aside className="absolute right-0 top-0 h-full w-full max-w-[520px] border-l bg-background shadow-xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="text-sm font-semibold">AI Assistant</div>
                <button
                  type="button"
                  className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
                  onClick={() => setAiOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="px-4 py-3">
                <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Draft replies for the selected thread.
                  <div className="mt-2">
                    Thread:{" "}
                    <span className="font-mono">
                      {selectedThreadId ? shortText(selectedThreadId, 64) : "none"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canReplyWithAi}
                    onClick={() => onAiSend("Draft a reply. Be clear and professional.")}
                    className="rounded-full border px-4 py-2 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    Draft reply
                  </button>
                  <button
                    type="button"
                    disabled={!canReplyWithAi}
                    onClick={() => onAiSend("Rewrite the reply more concise.")}
                    className="rounded-full border px-4 py-2 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    Shorter
                  </button>
                  <button
                    type="button"
                    disabled={!canReplyWithAi}
                    onClick={() => onAiSend("Rewrite the reply friendlier.")}
                    className="rounded-full border px-4 py-2 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    Friendlier
                  </button>
                  <button
                    type="button"
                    disabled={!canReplyWithAi}
                    onClick={() => onAiSend("Rewrite the reply firmer and more direct.")}
                    className="rounded-full border px-4 py-2 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    Firmer
                  </button>
                </div>
              </div>

              <div ref={aiScrollRef} className="flex-1 overflow-auto px-4 pb-4">
                <div className="space-y-2">
                  {aiMsgs.length === 0 ? (
                    <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                      Ask me to draft a reply for the selected thread.
                    </div>
                  ) : (
                    aiMsgs.map((m, idx) => (
                      <div
                        key={`${m.at}-${idx}`}
                        className={cx(
                          "rounded-lg border p-3 text-sm whitespace-pre-wrap",
                          m.role === "user" ? "bg-background" : "bg-muted/20",
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
                              className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
                              onClick={() => setReplyBody(m.text)}
                              title="Insert into reply editor"
                            >
                              Insert into reply
                            </button>
                            <button
                              type="button"
                              className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
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
                <div className="rounded-lg border bg-background p-2">
                  <textarea
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    rows={3}
                    className="w-full resize-none bg-transparent p-2 text-sm outline-none"
                    placeholder={selectedThreadId ? 'Ask: "Decline politely and propose next week."' : "Select a thread first…"}
                    disabled={!selectedThreadId || !botId.trim().length}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        onAiSend().catch(() => {});
                      }
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground">Ctrl/⌘ + Enter to send</div>
                  <button
                    type="button"
                    onClick={() => onAiSend().catch(() => {})}
                    disabled={!selectedThreadId || !botId.trim().length || replyDrafting || !aiInput.trim().length}
                    className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-60"
                  >
                    {replyDrafting ? "Thinking…" : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}