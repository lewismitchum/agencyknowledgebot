"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Clock3,
  FileText,
  Film,
  ImageIcon,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

type Msg = { role: "user" | "assistant"; text: string };
type BotRow = { id: string; name: string };

type UploadResp = {
  ok?: boolean;
  bot_id?: string;
  uploaded?: Array<{ document_id: string; filename: string; openai_file_id: string }>;
  error?: string;
  message?: string;
};

type AttachmentKind = "image" | "video" | "pdf" | "file";

type Attachment = {
  document_id: string;
  filename: string;
  kind: AttachmentKind;
};

class HttpError extends Error {
  status: number;
  statusText: string;
  bodyText: string;

  constructor(message: string, status: number, statusText: string, bodyText = "") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.bodyText = bodyText;
  }
}

async function getJson<T = any>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: init.credentials ?? "include",
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

  const raw = await res.text().catch(() => "");
  let data: any = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      (data && (data.message || data.error)) ||
      raw ||
      `Request failed (${res.status} ${res.statusText})`;

    throw new HttpError(String(message), res.status, res.statusText, raw);
  }

  return (data ?? (raw as any)) as T;
}

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

function detectIanaTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return String(tz || "").trim() || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

function parseMaybeJson(text: string): any {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

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

    if (line.trim().startsWith("```")) {
      flushAllTextBlocks();
      const fence = line.trim();
      const lang = fence.slice(3).trim();
      i++;

      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith("```")) i++;

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded-2xl border border-white/10 bg-black/10 p-3 text-[12px] leading-relaxed"
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

    if (!trimmed) {
      flushAllTextBlocks();
      i++;
      continue;
    }

    const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushAllTextBlocks();
      const level = h[1].length;
      const content = h[2].trim();
      const cls =
        level === 1 ? "text-base font-semibold" : level === 2 ? "text-sm font-semibold" : "text-sm font-medium";
      const Tag: any = level === 1 ? "h3" : "h4";
      blocks.push(
        <Tag key={`h-${blocks.length}`} className={cls}>
          {renderInline(content)}
        </Tag>
      );
      i++;
      continue;
    }

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

function TopPill({
  icon,
  children,
  variant = "outline",
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: "outline" | "secondary" | "default";
}) {
  return (
    <Badge variant={variant} className="gap-1.5 rounded-full px-3 py-1">
      {icon}
      {children}
    </Badge>
  );
}

function getAttachmentKind(filename: string): AttachmentKind {
  const lower = String(filename || "").toLowerCase().trim();
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg|heic)$/.test(lower)) return "image";
  if (/\.(mp4|mov|avi|mkv|webm|m4v)$/.test(lower)) return "video";
  if (/\.pdf$/.test(lower)) return "pdf";
  return "file";
}

function attachmentKindLabel(kind: AttachmentKind) {
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  if (kind === "pdf") return "PDF";
  return "File";
}

function attachmentKindIcon(kind: AttachmentKind) {
  if (kind === "image") return <ImageIcon className="h-3.5 w-3.5" />;
  if (kind === "video") return <Film className="h-3.5 w-3.5" />;
  if (kind === "pdf") return <FileText className="h-3.5 w-3.5" />;
  return <Paperclip className="h-3.5 w-3.5" />;
}

function attachmentTone(kind: AttachmentKind) {
  if (kind === "image") return "bg-blue-50 border-blue-200 text-blue-700";
  if (kind === "video") return "bg-purple-50 border-purple-200 text-purple-700";
  if (kind === "pdf") return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-muted border-border text-foreground";
}

function buildExportText(messages: Msg[], botName: string) {
  const lines: string[] = [];
  if (botName) lines.push(`Bot: ${botName}`);
  lines.push(`Exported: ${new Date().toLocaleString()}`);
  lines.push("");

  for (const m of messages) {
    lines.push(`${m.role === "user" ? "User" : "Louis"}:`);
    lines.push(m.text || "");
    lines.push("");
  }

  return lines.join("\n").trim();
}

export default function ChatPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);

  const [meStatus, setMeStatus] = useState<"active" | "pending" | "blocked" | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);

  const [documentsCount, setDocumentsCount] = useState(0);

  const [clientTimezone, setClientTimezone] = useState<string>("America/Chicago");

  const [usageLoaded, setUsageLoaded] = useState(false);
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null);
  const [dailyResetsInSeconds, setDailyResetsInSeconds] = useState(0);

  const [bots, setBots] = useState<BotRow[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState("");

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [bootError, setBootError] = useState("");
  const [accessBlocked, setAccessBlocked] = useState<"pending" | "blocked" | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedBotName = useMemo(
    () => bots.find((b: BotRow) => b.id === selectedBotId)?.name ?? "",
    [bots, selectedBotId]
  );

  const docsEmpty = documentsCount <= 0;

  const tzHeader = useMemo(() => {
    const tz = String(clientTimezone || "").trim() || "America/Chicago";
    return { "X-User-Timezone": tz };
  }, [clientTimezone]);

  const attachmentStats = useMemo(() => {
    return {
      images: attachments.filter((a) => a.kind === "image").length,
      videos: attachments.filter((a) => a.kind === "video").length,
      pdfs: attachments.filter((a) => a.kind === "pdf").length,
      files: attachments.filter((a) => a.kind === "file").length,
    };
  }, [attachments]);

  useEffect(() => {
    const initialFromUrl = getBotIdFromUrl();
    if (initialFromUrl) setSelectedBotId(initialFromUrl);
    setClientTimezone(detectIanaTimezone());
  }, []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    window.location.href = "/login";
  }

  async function persistTimezoneIfNeeded(meUserTimeZone: unknown) {
    const detected = detectIanaTimezone();
    setClientTimezone(detected);

    const serverTz = String(meUserTimeZone ?? "").trim();
    if (serverTz && serverTz === detected) return;

    try {
      const r = await fetch("/api/me/timezone", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: detected }),
      });

      if (!r.ok) return;

      const j: any = await r.json().catch(() => null);
      const saved = String(j?.timezone ?? j?.time_zone ?? "").trim();
      if (saved) setClientTimezone(saved);
    } catch {}
  }

  useEffect(() => {
    (async () => {
      try {
        setBootError("");

        const j: any = await getJson("/api/me");

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

        persistTimezoneIfNeeded(j?.user?.time_zone).catch(() => {});

        setDailyRemaining(normalizeDailyRemaining(j?.daily_remaining));

        const reset = Number(j?.daily_resets_in_seconds ?? 0);
        setDailyResetsInSeconds(reset);
      } catch (e: any) {
        if (e instanceof HttpError) {
          const status = e.status;
          if (status === 401) {
            window.location.href = "/login";
            return;
          }
          if (status === 403) {
            const body = parseMaybeJson(e.bodyText || "");
            const message = String(body?.message ?? e.bodyText ?? "").toLowerCase();
            const blocked = message.includes("blocked");
            setAccessBlocked(blocked ? "blocked" : "pending");
            setMeStatus(blocked ? "blocked" : "pending");
            return;
          }
          setBootError(e.bodyText || `Failed to load session (${status})`);
        } else {
          setBootError(e?.message || "Failed to load session");
        }
      } finally {
        setUsageLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (accessBlocked) {
      setBots([]);
      setBotsLoading(false);
      return;
    }

    (async () => {
      try {
        setBootError("");
        const j: any = await getJson("/api/bots");
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
        if (e instanceof HttpError) {
          if (e.status === 401) return (window.location.href = "/login");
          if (e.status === 403) {
            setAccessBlocked("pending");
            setBots([]);
            return;
          }
          if (e.status === 405) {
            setBootError(`405 from /api/bots (method mismatch). Check app/api/bots/route.ts exports GET.`);
            setBots([]);
            return;
          }
          setBootError(`Failed to load bots: ${e.bodyText || `${e.status} ${e.statusText}`}`);
          setBots([]);
        } else {
          setBootError(`Failed to load bots: ${String(e?.message ?? e)}`);
          setBots([]);
        }
      } finally {
        setBotsLoading(false);
      }
    })();
  }, [accessBlocked, selectedBotId]);

  useEffect(() => {
    if (!selectedBotId) return;
    if (accessBlocked) return;

    (async () => {
      try {
        setBootError("");
        const url = `/api/conversation/messages?bot_id=${encodeURIComponent(selectedBotId)}`;
        const j: any = await getJson(url);
        setMessages(Array.isArray(j?.messages) ? (j.messages as Msg[]) : []);
      } catch (e: any) {
        if (e instanceof HttpError) {
          if (e.status === 405) {
            const url = `/api/conversation/messages?bot_id=${encodeURIComponent(selectedBotId)}`;
            setBootError(
              `405 from ${url}. You likely don't have GET implemented at app/api/conversation/messages/route.ts`
            );
            setMessages([]);
            return;
          }
        }
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
    setAttachments([]);
    setAttachError("");

    setSelectedBotId(nextId);
    setBotIdInUrl(nextId);
  }

  function openFilePicker() {
    if (!selectedBotId) return;
    if (uploadingAttachments) return;
    setAttachError("");
    fileInputRef.current?.click();
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!selectedBotId) return;
    if (accessBlocked) return;

    setAttachError("");
    setUploadingAttachments(true);

    try {
      const fd = new FormData();
      fd.set("bot_id", selectedBotId);
      for (const f of Array.from(files)) {
        fd.append("files", f);
      }

      const r = await fetch("/api/upload", {
        method: "POST",
        credentials: "include",
        headers: { ...tzHeader },
        body: fd,
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = (await safeJson(r)) as UploadResp;

      if (!r.ok || !j?.ok) {
        const msg = String(j?.message || j?.error || `Upload failed (${r.status})`);
        setAttachError(msg);
        return;
      }

      const rows = Array.isArray(j.uploaded) ? j.uploaded : [];
      const next: Attachment[] = rows
        .map((x) => {
          const filename = String(x?.filename || "file").trim();
          return {
            document_id: String(x?.document_id || "").trim(),
            filename,
            kind: getAttachmentKind(filename),
          };
        })
        .filter((x) => x.document_id);

      if (next.length) {
        setAttachments((prev) => {
          const merged = [...prev, ...next];
          const seen = new Set<string>();
          return merged.filter((a) => {
            if (seen.has(a.document_id)) return false;
            seen.add(a.document_id);
            return true;
          });
        });
      }
    } catch (e: any) {
      setAttachError(String(e?.message ?? e ?? "Upload failed"));
    } finally {
      setUploadingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(documentId: string) {
    setAttachments((prev) => prev.filter((a) => a.document_id !== documentId));
  }

  async function exportPdf() {
    if (!messages.length || exportingPdf) return;

    setExportingPdf(true);
    setAttachError("");

    try {
      const title = selectedBotName ? `${selectedBotName} Chat Export` : "Louis Chat Export";
      const text = buildExportText(messages, selectedBotName);

      const res = await fetch("/api/chat/export-pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...tzHeader },
        body: JSON.stringify({
          title,
          filename: title,
          text,
        }),
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!res.ok) {
        const body = await safeJson(res);
        throw new Error(String((body as any)?.message || (body as any)?.error || "Failed to export PDF"));
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9-_]+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setAttachError(String(e?.message ?? e ?? "Failed to export PDF"));
    } finally {
      setExportingPdf(false);
    }
  }

  async function send() {
    if (!selectedBotId) return;
    if (!input.trim() || loading) return;
    if (accessBlocked) return;

    if (dailyRemaining !== null && dailyRemaining === 0 && dailyResetsInSeconds > 0) return;

    const userMsg = input.trim();
    const attachIds = attachments.map((a) => a.document_id).filter(Boolean);

    setInput("");
    setMessages((m: Msg[]) => [...m, { role: "user", text: userMsg }]);
    setLoading(true);
    setAttachError("");

    try {
      const j: any = await getJson("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tzHeader },
        body: JSON.stringify({
          message: userMsg,
          bot_id: selectedBotId,
          attachments: attachIds.length ? attachIds : undefined,
        }),
      });

      if (j?.bot_id && typeof j.bot_id === "string" && j.bot_id !== selectedBotId) {
        onChangeBot(j.bot_id);
        return;
      }

      setMessages((m: Msg[]) => [...m, { role: "assistant", text: String(j?.answer ?? j?.text ?? "") }]);

      setAttachments([]);

      setUsageLoaded(true);

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
      if (e instanceof HttpError) {
        if (e.status === 405) {
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

        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (e.status === 403) {
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

        const body = parseMaybeJson(e.bodyText || "");
        const msg = String(body?.message ?? e.bodyText ?? "").trim();
        setMessages((m: Msg[]) => [...m, { role: "assistant", text: msg ? `Error: ${msg}` : "Request failed." }]);
        return;
      }

      setMessages((m: Msg[]) => [...m, { role: "assistant", text: `Network error: ${String(e?.message ?? e)}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function newChat() {
    if (!selectedBotId) return;
    if (accessBlocked) return;

    try {
      await getJson("/api/conversation/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tzHeader },
        body: JSON.stringify({ bot_id: selectedBotId }),
      });
    } catch (e: any) {
      if (e instanceof HttpError && e.status === 405) {
        setBootError(
          `405 from /api/conversation/reset. You likely don't have POST implemented at app/api/conversation/reset/route.ts`
        );
      }
    }

    setMessages([]);
    setAttachments([]);
    setAttachError("");
  }

  const dailyKnown = usageLoaded;
  const dailyBlocked = dailyRemaining !== null && dailyResetsInSeconds > 0 && dailyRemaining === 0;

  const canSend =
    !!selectedBotId && !loading && !accessBlocked && !dailyBlocked && input.trim().length > 0 && !uploadingAttachments;

  if (accessBlocked) {
    const title = accessBlocked === "blocked" ? "Access blocked" : "Pending approval";
    const desc =
      accessBlocked === "blocked"
        ? "Your account has been blocked by the agency owner. Contact your owner if you think this is a mistake."
        : "Your account is pending approval by the agency owner. You’ll be able to use Louis.Ai once approved.";

    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card className="rounded-[28px] border bg-card/80 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full">
                {email || "Unknown user"}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                Role: {meRole || "member"}
              </Badge>
              <Badge variant={accessBlocked === "blocked" ? "destructive" : "outline"} className="rounded-full">
                Status: {meStatus || accessBlocked}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                TZ: {clientTimezone}
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border bg-card/80 p-6 shadow-sm backdrop-blur md:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.12),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/65 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Louis chat
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Chat with your docs and your workflow.
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Louis prioritizes your docs for internal answers, while still handling general reasoning when appropriate.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {!dailyKnown ? (
                <TopPill icon={<Clock3 className="h-3.5 w-3.5" />}>Usage loading…</TopPill>
              ) : dailyRemaining === null ? (
                <TopPill icon={<ShieldCheck className="h-3.5 w-3.5" />} variant="secondary">
                  Unlimited
                </TopPill>
              ) : dailyRemaining > 0 ? (
                <TopPill icon={<MessageSquare className="h-3.5 w-3.5" />}>{dailyRemaining} left today</TopPill>
              ) : dailyResetsInSeconds > 0 ? (
                <TopPill icon={<Clock3 className="h-3.5 w-3.5" />}>{dailyRemaining} left today</TopPill>
              ) : (
                <TopPill variant="outline">Usage unavailable</TopPill>
              )}

              <TopPill variant={emailVerified ? "secondary" : "outline"}>
                {emailVerified ? "Verified" : "Unverified"}
              </TopPill>

              {dailyRemaining !== null && dailyResetsInSeconds > 0 ? (
                <TopPill icon={<Clock3 className="h-3.5 w-3.5" />} variant="outline">
                  Resets in {formatCountdown(dailyResetsInSeconds)}
                </TopPill>
              ) : null}

              <TopPill variant="outline">TZ: {clientTimezone}</TopPill>

              {documentsCount > 0 ? (
                <TopPill icon={<FileText className="h-3.5 w-3.5" />} variant="secondary">
                  {documentsCount} docs
                </TopPill>
              ) : (
                <TopPill icon={<FileText className="h-3.5 w-3.5" />} variant="outline">
                  No docs yet
                </TopPill>
              )}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[320px]">
            <div className="rounded-2xl border bg-background/60 p-3 backdrop-blur">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Active bot</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                <Bot className="h-4 w-4 text-muted-foreground" />
                {botsLoading ? "Loading…" : selectedBotName || "None selected"}
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-2xl" onClick={newChat} disabled={!selectedBotId}>
                <Plus className="mr-2 h-4 w-4" />
                New chat
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-2xl"
                onClick={exportPdf}
                disabled={!messages.length || exportingPdf}
              >
                <Download className="mr-2 h-4 w-4" />
                {exportingPdf ? "Exporting…" : "Export PDF"}
              </Button>
              <Button asChild variant="outline" className="flex-1 rounded-2xl">
                <Link href="/app/bots">Manage bots</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {bootError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{bootError}</div>
      ) : null}

      {docsEmpty ? (
        <div className="rounded-[28px] border bg-card/75 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium">No docs uploaded yet</div>
              <div className="mt-1 text-sm text-muted-foreground">
                You can still ask general questions. For internal answers, upload at least one doc so Louis can ground
                its response in your workspace.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild className="rounded-2xl">
                <Link href="/app/docs">Upload docs</Link>
              </Button>
              <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => window.location.reload()}>
                Refresh
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-[28px] border bg-card/75 shadow-sm backdrop-blur">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-xl tracking-tight">Workspace chat</CardTitle>
              <CardDescription className="mt-1">
                Ask internal questions, attach images, PDFs, files, or videos, and keep conversation history tied to
                the selected bot.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2" data-tour="chat-bot-selector">
              <div className="text-sm text-muted-foreground">Bot</div>
              <select
                className="h-10 rounded-2xl border bg-background/70 px-3 text-sm backdrop-blur"
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
            </div>
          </div>

          <Separator />
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="h-[540px] overflow-y-auto rounded-[28px] border border-white/10 bg-background/45 p-4 shadow-sm backdrop-blur-xl">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-md text-center">
                  <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-3xl border bg-background/70 text-muted-foreground shadow-sm">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <div className="mt-4 text-sm font-medium text-foreground">
                    {selectedBotId ? "Start the conversation" : "Select a bot to begin"}
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {selectedBotId
                      ? "Ask anything. Louis can use images, PDFs, and your uploaded docs when relevant."
                      : "Choose a bot above, then start chatting with your workspace knowledge."}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                {messages.map((m: Msg, i: number) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] ${m.role === "user" ? "items-end" : "items-start"}`}>
                      <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {m.role === "user" ? "You" : "Louis"}
                      </div>
                      <div
                        className={`rounded-[24px] border border-white/10 px-4 py-3 text-sm leading-relaxed shadow-sm backdrop-blur-xl ${
                          m.role === "user"
                            ? "bg-foreground text-background"
                            : "bg-background/70 text-foreground"
                        }`}
                      >
                        {m.role === "assistant" ? (
                          <AssistantMarkdown text={m.text} />
                        ) : (
                          <span className="whitespace-pre-wrap">{m.text}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="max-w-[88%]">
                      <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Louis
                      </div>
                      <div className="rounded-[24px] border border-white/10 bg-background/70 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur-xl">
                        Thinking…
                      </div>
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="rounded-[28px] border bg-background/45 p-4 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => uploadFiles(e.target.files).catch(() => {})}
              />

              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={openFilePicker}
                disabled={!selectedBotId || uploadingAttachments || dailyBlocked}
                title="Attach images, videos, PDFs, and files"
              >
                <Paperclip className="mr-2 h-4 w-4" />
                {uploadingAttachments ? "Uploading…" : "Attach"}
              </Button>

              <Badge variant="outline" className="rounded-full">
                {attachments.length} attached
              </Badge>

              {attachmentStats.images > 0 ? (
                <Badge variant="outline" className="rounded-full gap-1">
                  <ImageIcon className="h-3.5 w-3.5" />
                  {attachmentStats.images} image{attachmentStats.images === 1 ? "" : "s"}
                </Badge>
              ) : null}

              {attachmentStats.pdfs > 0 ? (
                <Badge variant="outline" className="rounded-full gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {attachmentStats.pdfs} PDF{attachmentStats.pdfs === 1 ? "" : "s"}
                </Badge>
              ) : null}

              {attachmentStats.videos > 0 ? (
                <Badge variant="outline" className="rounded-full gap-1">
                  <Film className="h-3.5 w-3.5" />
                  {attachmentStats.videos} video{attachmentStats.videos === 1 ? "" : "s"}
                </Badge>
              ) : null}

              {attachmentStats.files > 0 ? (
                <Badge variant="outline" className="rounded-full gap-1">
                  <Paperclip className="h-3.5 w-3.5" />
                  {attachmentStats.files} file{attachmentStats.files === 1 ? "" : "s"}
                </Badge>
              ) : null}
            </div>

            <div className="mt-3 rounded-2xl border bg-background/60 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Attachment preview
              </div>

              {attachments.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {attachments.slice(0, 12).map((a) => (
                    <span
                      key={a.document_id}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur ${attachmentTone(
                        a.kind
                      )}`}
                      title={a.document_id}
                    >
                      {attachmentKindIcon(a.kind)}
                      <span className="font-medium">{attachmentKindLabel(a.kind)}</span>
                      <span className="max-w-[220px] truncate">{a.filename || "file"}</span>
                      <button
                        type="button"
                        className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-white/50"
                        onClick={() => removeAttachment(a.document_id)}
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {attachments.length > 12 ? (
                    <span className="text-xs text-muted-foreground">+{attachments.length - 12} more</span>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  No attachments selected. Add images, PDFs, files, or videos above.
                </div>
              )}
            </div>

            {attachError ? <div className="mt-3 text-xs text-destructive">{attachError}</div> : null}

            {attachmentStats.videos > 0 ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Videos can be attached and tracked in chat now. Full direct video understanding is not fully enabled yet,
                so Louis may answer using filenames, surrounding context, and any related docs/images.
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              <div data-tour="chat-input">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    !selectedBotId
                      ? "Select a bot first…"
                      : dailyBlocked
                        ? "Daily limit reached…"
                        : docsEmpty
                          ? "Ask anything… (Upload docs for stronger internal answers)"
                          : "Ask a question about your docs, PDFs, images, or workflow… (Ctrl/⌘ + Enter to send)"
                  }
                  disabled={!selectedBotId || dailyBlocked || uploadingAttachments}
                  className="min-h-[130px] rounded-[24px] border bg-background/70 px-4 py-3 text-sm shadow-sm backdrop-blur"
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
                  }}
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {dailyBlocked
                    ? `Daily limit reached. Resets in ${formatCountdown(dailyResetsInSeconds)}.`
                    : attachments.length
                      ? `Ready to send with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}.`
                      : "Louis prioritizes your uploaded docs for internal answers."}
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportPdf}
                    disabled={!messages.length || exportingPdf}
                    className="rounded-2xl px-5"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {exportingPdf ? "Exporting…" : "Export PDF"}
                  </Button>

                  <Button data-tour="chat-send" onClick={send} disabled={!canSend} className="rounded-2xl px-5">
                    <Send className="mr-2 h-4 w-4" />
                    {loading ? "Sending…" : uploadingAttachments ? "Uploading…" : dailyBlocked ? "Daily limit reached" : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        Need to manage bots?{" "}
        <Link className="underline" href="/app/bots">
          Go to Bots
        </Link>
      </div>
    </div>
  );
}