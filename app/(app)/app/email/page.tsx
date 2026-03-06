// app/(app)/app/email/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";
import {
  Bot as BotIcon,
  Inbox,
  Mail,
  PencilLine,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  FileText,
  ChevronRight,
  Wand2,
  PanelLeft,
} from "lucide-react";

type Upsell = { code?: string; message?: string };

type BotRow = {
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

function getFetchJsonStatus(e: any): number | null {
  if (!e || typeof e !== "object") return null;
  if ("status" in e) {
    const n = Number((e as any).status);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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

function isNotConnectedError(e: any) {
  const msg = String(e?.message || e?.error || "").toLowerCase();
  const code = String(e?.code || "").toLowerCase();
  if (code === "not_connected") return true;
  if (msg.includes("not connected")) return true;
  if (msg.includes("connect gmail")) return true;
  return false;
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
    <div className="rounded-3xl border bg-card/75 p-5 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-[2px] hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
          <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
        </div>
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onClick,
}: {
  thread: GmailThreadRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200",
        active
          ? "border-primary/25 bg-accent/60 shadow-sm"
          : "bg-background/40 hover:-translate-y-[1px] hover:bg-accent/30"
      )}
      title={thread.subject || thread.snippet || thread.id}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="truncate text-[12px] text-muted-foreground">{shortText(thread.from || "", 48)}</div>
        <div className="shrink-0 text-[11px] text-muted-foreground">{safeDateLabel(thread.date) || ""}</div>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{shortText(thread.subject || "(no subject)", 72)}</div>
      <div className="mt-1 truncate text-[12px] text-muted-foreground">{shortText(thread.snippet || "", 100)}</div>
    </button>
  );
}

function DraftRowButton({
  draft,
  active,
  onClick,
}: {
  draft: DraftRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200",
        active
          ? "border-primary/25 bg-accent/60 shadow-sm"
          : "bg-background/40 hover:-translate-y-[1px] hover:bg-accent/30"
      )}
      title={draft.subject}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="truncate text-[12px] text-muted-foreground">Draft</div>
        <div className="shrink-0 text-[11px] text-muted-foreground">{safeDateLabel(draft.created_at)}</div>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{shortText(draft.subject || "(no subject)", 72)}</div>
      <div className="mt-1 truncate text-[11px] font-mono text-muted-foreground">{shortText(draft.id, 50)}</div>
    </button>
  );
}

function MessageBubble({ msg }: { msg: GmailMessageRow }) {
  const body = String(msg.body || msg.snippet || "").trim();

  return (
    <div className="rounded-3xl border bg-background/45 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{msg.from || "(unknown sender)"}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {msg.to ? `to ${msg.to}` : ""}
            {msg.to && msg.date ? " · " : ""}
            {safeDateLabel(msg.date)}
          </div>
        </div>
      </div>

      {msg.subject ? <div className="mt-3 text-sm font-medium">{msg.subject}</div> : null}
      <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{body || "(no body)"}</div>
    </div>
  );
}

export default function EmailPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const [tab, setTab] = useState<"inbox" | "drafts" | "compose" | "docs-draft">("inbox");
  const [mobilePanel, setMobilePanel] = useState<"nav" | "list" | "detail">("list");

  const [bots, setBots] = useState<BotRow[]>([]);
  const [botId, setBotId] = useState("");

  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");

  const [gmailConnected, setGmailConnected] = useState<boolean>(false);
  const [connectHint, setConnectHint] = useState<string | null>(null);

  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [threads, setThreads] = useState<GmailThreadRow[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");
  const [thread, setThread] = useState<GmailThread | null>(null);

  const [replyDrafting, setReplyDrafting] = useState(false);
  const [replyDraftError, setReplyDraftError] = useState("");
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState<string>("");

  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendOk, setSendOk] = useState<string | null>(null);

  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeConfirm, setComposeConfirm] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [composeOk, setComposeOk] = useState<string | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiMsgs, setAiMsgs] = useState<AiChatMsg[]>([]);
  const [aiInput, setAiInput] = useState("");
  const aiScrollRef = useRef<HTMLDivElement | null>(null);

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
    return toOk && bodyOk && composeConfirm && !composeSending;
  }, [composeTo, composeBody, composeConfirm, composeSending]);

  const activeThread = threads.find((t) => t.id === selectedThreadId) || null;
  const activeBotName = botId ? bots.find((b) => b.id === botId)?.name || "Selected" : "None";
  const showListColumn = tab === "inbox" || tab === "drafts";
  const showReplyBar = tab === "inbox" && !!selectedThreadId && gmailConnected;

  useEffect(() => {
    if (!aiScrollRef.current) return;
    aiScrollRef.current.scrollTop = aiScrollRef.current.scrollHeight;
  }, [aiMsgs, aiOpen]);

  function goConnectGmail() {
    window.location.href = "/api/email/connect";
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const connected = url.searchParams.get("connected");
    const err = url.searchParams.get("error");

    if (connected === "1") {
      setConnectHint("Gmail connected.");
      setGmailConnected(true);
    } else if (connected === "0") {
      setConnectHint(err ? `Gmail connect failed: ${err}` : "Gmail connect failed.");
      setGmailConnected(false);
    }
  }, []);

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

        const connectedFromApi =
          typeof j?.gmail_connected === "boolean"
            ? j.gmail_connected
            : typeof j?.connected === "boolean"
              ? j.connected
              : null;

        if (connectedFromApi !== null) {
          setGmailConnected(connectedFromApi);
        }

        const allowed = Boolean(j?.ok) && !j?.upsell?.code;
        setGated(!allowed);

        if (allowed) {
          try {
            const b = await fetchJson<any>("/api/bots", {
              credentials: "include",
              cache: "no-store",
            });

            const list = Array.isArray(b?.bots) ? b.bots : Array.isArray(b) ? b : [];
            const parsed: BotRow[] = list
              .map((x: any) => ({
                id: String(x?.id || ""),
                name: String(x?.name || "Bot"),
                owner_user_id: x?.owner_user_id ?? null,
              }))
              .filter((x: BotRow) => x.id);

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

          const isConnectedNow = connectedFromApi !== null ? connectedFromApi : gmailConnected;

          if (!isConnectedNow) {
            setThreads([]);
            setSelectedThreadId(null);
            setThreadsError("Gmail is not connected.");
          } else {
            try {
              setThreadsLoading(true);
              setThreadsError("");
              setGmailConnected(true);

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
              if (cancelled) return;

              const st = getFetchJsonStatus(e);

              if (isFetchJsonError(e) && st === 409 && isNotConnectedError(e)) {
                setGmailConnected(false);
                setThreads([]);
                setSelectedThreadId(null);
                setThreadsError("Gmail is not connected.");
              } else {
                setThreadsError(e?.message ?? "Failed to load inbox threads");
              }
            } finally {
              if (!cancelled) setThreadsLoading(false);
            }
          }
        }
      } catch (e: any) {
        if (cancelled) return;

        const st = getFetchJsonStatus(e);
        if (isFetchJsonError(e) && st === 401) {
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
      setGmailConnected(true);

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

      if (!filtered.some((t) => t.id === selectedThreadId)) {
        setSelectedThreadId(filtered[0]?.id || null);
        setThread(null);
      }
    } catch (e: any) {
      const st = getFetchJsonStatus(e);

      if (isFetchJsonError(e) && st === 409 && isNotConnectedError(e)) {
        setGmailConnected(false);
        setThreads([]);
        setSelectedThreadId(null);
        setThreadsError("Gmail is not connected.");
      } else {
        setThreadsError(e?.message ?? "Failed to load inbox threads");
      }
    } finally {
      setThreadsLoading(false);
    }
  }

  async function loadThread(threadId: string) {
    const id = String(threadId || "").trim();
    if (!id) return;
    if (!gmailConnected) return;

    setSelectedThreadId(id);
    setMobilePanel("detail");
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
        subject: subject || messages[messages.length - 1]?.subject || "",
        messages: messages.filter((x) => x.id),
      });

      setAiMsgs((prev) => {
        if (prev.length) return prev;
        const s = subject || messages[messages.length - 1]?.subject || "";
        return [
          {
            role: "assistant",
            text: `Thread loaded. Ask me to draft a reply, rewrite tone, or summarize.\n\nSubject: ${s || "(no subject)"}`,
            at: Date.now(),
          },
        ];
      });
    } catch (e: any) {
      const st = getFetchJsonStatus(e);

      if (isFetchJsonError(e) && st === 401) {
        window.location.href = "/login";
        return;
      }
      if (isFetchJsonError(e) && st === 409 && isNotConnectedError(e)) {
        setGmailConnected(false);
        setThread(null);
        setThreadError("Gmail is not connected.");
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
      const st = getFetchJsonStatus(e);

      if (isFetchJsonError(e)) {
        if (st === 401) {
          window.location.href = "/login";
          return;
        }
        if (st === 403) {
          setReplyDraftError("Upgrade required to use Email inbox + replies.");
          setAiMsgs((prev) => [
            ...prev,
            { role: "assistant", text: "Email is locked to Corporation. Upgrade to continue.", at: Date.now() },
          ]);
          return;
        }
        if (st === 409) {
          if (isNotConnectedError(e)) {
            setReplyDraftError("Gmail is not connected. Click Connect Gmail.");
            setGmailConnected(false);
            return;
          }
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
      const st = getFetchJsonStatus(e);

      if (isFetchJsonError(e)) {
        if (st === 401) {
          window.location.href = "/login";
          return;
        }
        if (st === 403) {
          setSendError("Upgrade required to send.");
          return;
        }
        if (st === 409 && isNotConnectedError(e)) {
          setSendError("Gmail is not connected. Click Connect Gmail.");
          setGmailConnected(false);
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
      setMobilePanel("list");
    } catch (e: any) {
      const st = getFetchJsonStatus(e);

      if (isFetchJsonError(e)) {
        if (st === 401) {
          window.location.href = "/login";
          return;
        }
        if (st === 403) {
          setComposeError("Upgrade required to send.");
          return;
        }
        if (st === 409 && isNotConnectedError(e)) {
          setComposeError("Gmail is not connected. Click Connect Gmail.");
          setGmailConnected(false);
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
    setMobilePanel("detail");
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
      const st = getFetchJsonStatus(e);

      if (isFetchJsonError(e) && st === 401) {
        window.location.href = "/login";
        return;
      }
      if (isFetchJsonError(e) && st === 404) {
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
      setTab("drafts");
      setMobilePanel("detail");
    } catch (e: any) {
      const st = getFetchJsonStatus(e);

      if (isFetchJsonError(e)) {
        if (st === 401) {
          window.location.href = "/login";
          return;
        }
        if (st === 403) {
          setDraftError("Upgrade required to use Email drafting.");
          return;
        }
        if (st === 409) {
          if (isNotConnectedError(e)) {
            setDraftError("Gmail is not connected. Click Connect Gmail.");
            setGmailConnected(false);
            return;
          }
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
    setMobilePanel("detail");
  }

  useEffect(() => {
    if (!gated && gmailConnected && selectedThreadId && tab === "inbox") {
      loadThread(selectedThreadId).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [tab, gmailConnected]);

  useEffect(() => {
    if (tab === "compose" || tab === "docs-draft") {
      setMobilePanel("detail");
    } else if (tab === "inbox" || tab === "drafts") {
      setMobilePanel(selectedThreadId || selectedDraftId || draft ? "detail" : "list");
    }
  }, [tab, selectedThreadId, selectedDraftId, draft]);

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

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6">
      <div className="relative overflow-hidden rounded-[28px] border bg-card/80 p-6 shadow-sm backdrop-blur md:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.12),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/65 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Corporation email
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Gmail-style inbox with docs-backed drafting.
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Read threads, generate AI replies using your workspace docs, and send polished emails from one place.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[320px]">
            {!gmailConnected ? (
              <button
                type="button"
                onClick={goConnectGmail}
                className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-sm transition-all duration-200 hover:-translate-y-[1px] hover:opacity-95"
              >
                Connect Gmail
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  refreshThreads().catch(() => {});
                  refreshDrafts().catch(() => {});
                }}
                className="rounded-2xl border bg-background/60 px-4 py-3 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
              >
                Refresh inbox
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setTab("compose");
                setMobilePanel("detail");
              }}
              className="rounded-2xl border bg-background/60 px-4 py-3 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
            >
              Compose new email
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <TopStat
          icon={<Mail className="h-5 w-5" />}
          label="Connection"
          value={gmailConnected ? "On" : "Off"}
          hint={gmailConnected ? "Gmail connected" : "Connect to unlock inbox"}
        />
        <TopStat
          icon={<Inbox className="h-5 w-5" />}
          label="Threads"
          value={String(threads.length)}
          hint="Loaded in current inbox view"
        />
        <TopStat
          icon={<FileText className="h-5 w-5" />}
          label="Drafts"
          value={String(drafts.length)}
          hint="Saved docs-based drafts"
        />
        <TopStat
          icon={<BotIcon className="h-5 w-5" />}
          label="Bot"
          value={botId ? shortText(activeBotName, 14) : "None"}
          hint="Used for AI + docs drafting"
        />
      </div>

      {connectHint ? (
        <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{connectHint}</div>
      ) : null}

      {!gmailConnected ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-amber-900">
              <div className="font-semibold">Gmail not connected</div>
              <div className="mt-1 text-xs">Connect Gmail to load inbox threads and send replies from Louis.Ai.</div>
            </div>
            <button
              type="button"
              onClick={goConnectGmail}
              className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-95"
            >
              Connect Gmail
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_380px_1fr]">
        <aside
          className={cx(
            "rounded-[28px] border bg-card/75 p-4 shadow-sm backdrop-blur",
            mobilePanel !== "nav" && "hidden lg:block"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-base font-semibold">Email</div>
            <div className="text-[11px] font-mono text-muted-foreground">{plan ?? "unknown"}</div>
          </div>

          <button
            type="button"
            onClick={() => {
              setTab("compose");
              setMobilePanel("detail");
            }}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background hover:opacity-95"
          >
            <PencilLine className="h-4 w-4" />
            Compose
          </button>

          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bot</div>
            <select
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
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

          <nav className="mt-5 space-y-1">
            <button
              type="button"
              onClick={() => {
                setTab("inbox");
                setMobilePanel("list");
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-all duration-200",
                tab === "inbox" ? "bg-muted font-medium" : "hover:bg-muted/60"
              )}
            >
              <Inbox className="h-4 w-4" />
              Inbox
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("drafts");
                setMobilePanel("list");
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-all duration-200",
                tab === "drafts" ? "bg-muted font-medium" : "hover:bg-muted/60"
              )}
            >
              <FileText className="h-4 w-4" />
              Drafts
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("docs-draft");
                setMobilePanel("detail");
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-all duration-200",
                tab === "docs-draft" ? "bg-muted font-medium" : "hover:bg-muted/60"
              )}
            >
              <Sparkles className="h-4 w-4" />
              Draft from docs
            </button>
          </nav>

          <div className="mt-6 space-y-2 border-t pt-4">
            {!gmailConnected ? (
              <button
                type="button"
                onClick={goConnectGmail}
                className="w-full rounded-2xl bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-95"
              >
                Connect Gmail
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                refreshThreads().catch(() => {});
                refreshDrafts().catch(() => {});
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm hover:bg-muted"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </aside>

        {showListColumn ? (
          <section
            className={cx(
              "overflow-hidden rounded-[28px] border bg-card/75 shadow-sm backdrop-blur",
              mobilePanel !== "list" && "hidden lg:block"
            )}
          >
            <div className="border-b px-4 py-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMobilePanel("nav")}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border lg:hidden"
                    >
                      <PanelLeft className="h-4 w-4" />
                    </button>
                    <div className="text-sm font-semibold">{tab === "drafts" ? "Drafts" : "Threads"}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => (tab === "drafts" ? refreshDrafts() : refreshThreads()).catch(() => {})}
                    className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                    disabled={tab === "inbox" && !gmailConnected}
                  >
                    Reload
                  </button>
                </div>

                {tab === "inbox" ? (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                      className="h-11 w-full rounded-full border bg-background px-10 pr-24 text-sm outline-none"
                      disabled={!gmailConnected}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60"
                      onClick={() => {
                        const next = String(q || "").trim();
                        setQApplied(next);
                        refreshThreads(next).catch(() => {});
                      }}
                      disabled={!gmailConnected}
                    >
                      Search
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="h-[760px] overflow-auto p-3">
              {tab === "inbox" ? (
                !gmailConnected ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="font-semibold">Connect Gmail to load inbox.</div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={goConnectGmail}
                        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-95"
                      >
                        Connect Gmail
                      </button>
                    </div>
                  </div>
                ) : threadsLoading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                ) : threadsError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{threadsError}</div>
                ) : threads.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No threads found.</div>
                ) : (
                  <div className="space-y-2">
                    {threads.slice(0, 80).map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        active={selectedThreadId === t.id}
                        onClick={() => {
                          setTab("inbox");
                          loadThread(t.id).catch(() => {});
                        }}
                      />
                    ))}
                  </div>
                )
              ) : draftsLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : draftsError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{draftsError}</div>
              ) : drafts.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No drafts yet.</div>
              ) : (
                <div className="space-y-2">
                  {openDraftError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {openDraftError}
                    </div>
                  ) : null}

                  {drafts.slice(0, 80).map((d) => (
                    <DraftRowButton
                      key={d.id}
                      draft={d}
                      active={selectedDraftId === d.id}
                      onClick={() => onOpenDraft(d.id).catch(() => {})}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        <main
          className={cx(
            "overflow-hidden rounded-[28px] border bg-card/75 shadow-sm backdrop-blur",
            mobilePanel !== "detail" && "hidden lg:block"
          )}
        >
          {tab === "compose" ? (
            <div className="h-[760px] overflow-auto px-6 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setMobilePanel("nav")}
                    className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border lg:hidden"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>

                  <div>
                    <div className="text-xl font-semibold tracking-tight">Compose</div>
                    <div className="mt-1 text-sm text-muted-foreground">Send a new email.</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTab("docs-draft");
                      setMobilePanel("detail");
                    }}
                    className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                  >
                    Draft from docs
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab("inbox");
                      setMobilePanel("list");
                    }}
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
                      className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
                      placeholder="name@company.com"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-sm font-medium">Cc</div>
                      <input
                        value={composeCc}
                        onChange={(e) => setComposeCc(e.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
                        placeholder="optional"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Bcc</div>
                      <input
                        value={composeBcc}
                        onChange={(e) => setComposeBcc(e.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
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
                    className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
                    placeholder="(no subject)"
                  />
                </div>

                <div>
                  <div className="text-sm font-medium">Message</div>
                  <textarea
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    rows={16}
                    className="mt-2 w-full rounded-2xl border bg-background p-4 text-sm outline-none"
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
                      className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" />
                      {composeSending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>

                {composeError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {composeError}
                  </div>
                ) : null}

                {composeOk ? <div className="rounded-2xl border bg-muted/30 p-4 text-sm">{composeOk}</div> : null}
              </div>
            </div>
          ) : tab === "docs-draft" ? (
            <div className="h-[760px] overflow-auto px-6 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setMobilePanel("nav")}
                    className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border lg:hidden"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>

                  <div>
                    <div className="text-xl font-semibold tracking-tight">Draft from docs</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Generate a docs-backed email draft using the selected bot.
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setTab("compose");
                    setMobilePanel("detail");
                  }}
                  className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                >
                  Open compose
                </button>
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium">Tone</div>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
                    >
                      <option value="direct">Direct</option>
                      <option value="professional">Professional</option>
                      <option value="warm">Warm</option>
                      <option value="persuasive">Persuasive</option>
                    </select>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-sm font-medium">Recipient name</div>
                      <input
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
                        placeholder="Jane Doe"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Recipient company</div>
                      <input
                        value={recipientCompany}
                        onChange={(e) => setRecipientCompany(e.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm"
                        placeholder="Acme"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium">Prompt</div>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={8}
                      className="mt-2 w-full rounded-2xl border bg-background p-4 text-sm outline-none"
                      placeholder="Write a follow-up email about the proposal using our uploaded docs."
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onDraftFromDocs().catch(() => {})}
                      disabled={!canDraft}
                      className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-60"
                    >
                      <Wand2 className="h-4 w-4" />
                      {drafting ? "Drafting…" : "Generate draft"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPrompt("");
                        setRecipientName("");
                        setRecipientCompany("");
                        setDraft(null);
                        setFallback(null);
                        setDraftError("");
                      }}
                      className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                    >
                      Clear
                    </button>
                  </div>

                  {draftError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {draftError}
                    </div>
                  ) : null}

                  {fallback ? (
                    <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">{fallback}</div>
                  ) : null}
                </div>

                <div className="rounded-3xl border bg-background/40 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Generated draft</div>
                      <div className="mt-1 text-xs text-muted-foreground">Review here, then move it into Compose.</div>
                    </div>

                    {draft ? (
                      <button
                        type="button"
                        onClick={moveDraftIntoCompose}
                        className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                      >
                        Move to compose
                      </button>
                    ) : null}
                  </div>

                  {draft ? (
                    <div className="mt-4 space-y-4">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Subject</div>
                        <div className="mt-2 rounded-2xl border bg-background p-3 text-sm">{draft.subject}</div>
                      </div>

                      <div>
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Body</div>
                        <div className="mt-2 whitespace-pre-wrap rounded-2xl border bg-background p-4 text-sm leading-6">
                          {draft.body}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 flex min-h-[320px] items-center justify-center rounded-2xl border bg-background/50 p-6 text-sm text-muted-foreground">
                      Generate a docs-backed draft to preview it here.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : tab === "drafts" ? (
            <div className="h-[760px] overflow-auto px-6 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setMobilePanel("list")}
                    className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border lg:hidden"
                  >
                    <ChevronRight className="h-4 w-4 rotate-180" />
                  </button>

                  <div>
                    <div className="text-xl font-semibold tracking-tight">Draft preview</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Open a saved draft from the left, then move it into Compose.
                    </div>
                  </div>
                </div>

                {draft ? (
                  <button
                    type="button"
                    onClick={moveDraftIntoCompose}
                    className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                  >
                    Move to compose
                  </button>
                ) : null}
              </div>

              {openingDraft ? (
                <div className="mt-6 text-sm text-muted-foreground">Opening draft…</div>
              ) : draft ? (
                <div className="mt-6 space-y-4">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Subject</div>
                    <div className="mt-2 rounded-2xl border bg-background p-3 text-sm">{draft.subject}</div>
                  </div>

                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Body</div>
                    <div className="mt-2 whitespace-pre-wrap rounded-2xl border bg-background p-4 text-sm leading-6">
                      {draft.body}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 flex min-h-[320px] items-center justify-center rounded-2xl border bg-background/50 p-6 text-sm text-muted-foreground">
                  Select a draft from the left to preview it here.
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-[760px] flex-col overflow-hidden">
              <div className="border-b px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setMobilePanel("list")}
                      className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border lg:hidden"
                    >
                      <ChevronRight className="h-4 w-4 rotate-180" />
                    </button>

                    <div>
                      <div className="text-xl font-semibold tracking-tight">
                        {thread?.subject || activeThread?.subject || "Inbox"}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {activeThread?.from ? `Latest from ${activeThread.from}` : "Open a thread to read and reply."}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAiOpen(true)}
                      className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                      disabled={!gmailConnected || !selectedThreadId}
                    >
                      Open AI
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-auto px-6 py-6">
                {!gmailConnected ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Gmail not connected.
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={goConnectGmail}
                        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-95"
                      >
                        Connect Gmail
                      </button>
                    </div>
                  </div>
                ) : threadLoading ? (
                  <div className="text-sm text-muted-foreground">Loading thread…</div>
                ) : threadError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{threadError}</div>
                ) : !thread ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="max-w-md text-center">
                      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-3xl border bg-background/70 text-muted-foreground shadow-sm">
                        <Mail className="h-6 w-6" />
                      </div>
                      <div className="mt-4 text-sm font-medium text-foreground">Select a thread</div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        Open a thread from the left to read messages and draft a reply.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {thread.messages.map((m) => (
                      <MessageBubble key={m.id} msg={m} />
                    ))}
                  </div>
                )}
              </div>

              {showReplyBar ? (
                <div className="border-t bg-background/70 px-6 py-4 backdrop-blur">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAiOpen(true)}
                        disabled={!selectedThreadId || !botId.trim().length || !gmailConnected}
                        className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
                      >
                        <Sparkles className="h-4 w-4" />
                        AI reply
                      </button>

                      <div className="text-xs text-muted-foreground">
                        Generate a draft with AI, edit below, then confirm send.
                      </div>
                    </div>

                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={6}
                      className="w-full rounded-2xl border bg-background p-4 text-sm outline-none"
                      placeholder="AI draft will appear here, or write your own reply…"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3">
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
                          onClick={() => {
                            setReplyBody("");
                            setReplyDraftId(null);
                            setSendError("");
                            setSendOk(null);
                            setConfirmSend(false);
                          }}
                          className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
                        >
                          Clear
                        </button>

                        <button
                          type="button"
                          onClick={() => onSendReply().catch(() => {})}
                          disabled={sending || !replyBody.trim().length || !replyDraftId}
                          className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-60"
                        >
                          <Send className="h-4 w-4" />
                          {sending ? "Sending…" : "Send reply"}
                        </button>
                      </div>
                    </div>

                    {replyDraftError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        {replyDraftError}
                      </div>
                    ) : null}

                    {sendError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        {sendError}
                      </div>
                    ) : null}

                    {sendOk ? <div className="rounded-2xl border bg-muted/30 p-4 text-sm">{sendOk}</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </main>
      </div>

      <div className="grid grid-cols-4 gap-2 lg:hidden">
        <button
          type="button"
          onClick={() => {
            setTab("inbox");
            setMobilePanel("list");
          }}
          className={cx(
            "rounded-2xl border px-3 py-2 text-sm",
            tab === "inbox" ? "bg-muted font-medium" : "hover:bg-muted"
          )}
        >
          Inbox
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("drafts");
            setMobilePanel("list");
          }}
          className={cx(
            "rounded-2xl border px-3 py-2 text-sm",
            tab === "drafts" ? "bg-muted font-medium" : "hover:bg-muted"
          )}
        >
          Drafts
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("compose");
            setMobilePanel("detail");
          }}
          className={cx(
            "rounded-2xl border px-3 py-2 text-sm",
            tab === "compose" ? "bg-muted font-medium" : "hover:bg-muted"
          )}
        >
          Compose
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("docs-draft");
            setMobilePanel("detail");
          }}
          className={cx(
            "rounded-2xl border px-3 py-2 text-sm",
            tab === "docs-draft" ? "bg-muted font-medium" : "hover:bg-muted"
          )}
        >
          Docs
        </button>
      </div>

      {aiOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAiOpen(false)} />
          <aside className="absolute right-0 top-0 h-full w-full max-w-[560px] border-l bg-background shadow-xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-4">
                <div>
                  <div className="text-sm font-semibold">AI Assistant</div>
                  <div className="mt-1 text-xs text-muted-foreground">Draft replies for the selected thread.</div>
                </div>
                <button
                  type="button"
                  className="rounded-full border px-4 py-2 text-xs hover:bg-muted"
                  onClick={() => setAiOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="px-4 py-3">
                <div className="rounded-2xl border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Thread: <span className="font-mono">{selectedThreadId ? shortText(selectedThreadId, 64) : "none"}</span>
                </div>

                {!gmailConnected ? (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Gmail not connected.
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={goConnectGmail}
                        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-95"
                      >
                        Connect Gmail
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div ref={aiScrollRef} className="flex-1 overflow-auto px-4 pb-4">
                <div className="space-y-2">
                  {aiMsgs.length === 0 ? (
                    <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                      Ask me to draft a reply for the selected thread.
                    </div>
                  ) : (
                    aiMsgs.map((m, idx) => (
                      <div
                        key={`${m.at}-${idx}`}
                        className={cx(
                          "whitespace-pre-wrap rounded-2xl border p-3 text-sm",
                          m.role === "user" ? "bg-background" : "bg-muted/20"
                        )}
                      >
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {m.role === "user" ? "You" : "Louis"}
                        </div>
                        {m.text}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border-t p-4">
                <div className="rounded-2xl border bg-background p-2">
                  <textarea
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    rows={3}
                    className="w-full resize-none bg-transparent p-2 text-sm outline-none"
                    placeholder={selectedThreadId ? 'Ask: "Decline politely and propose next week."' : "Select a thread first…"}
                    disabled={!selectedThreadId || !botId.trim().length || !gmailConnected}
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
                    disabled={!selectedThreadId || !botId.trim().length || replyDrafting || !aiInput.trim().length || !gmailConnected}
                    className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-60"
                  >
                    {replyDrafting ? "Thinking…" : "Send"}
                    {!replyDrafting ? <ChevronRight className="h-4 w-4" /> : null}
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