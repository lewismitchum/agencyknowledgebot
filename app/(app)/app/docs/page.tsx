"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";
import {
  ArrowRight,
  Bot,
  FileText,
  Image,
  Pencil,
  RefreshCw,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";

type DocRow = {
  id: string;
  filename: string;
  bot_id?: string | null;
  openai_file_id?: string | null;
  created_at: string | null;
  bytes?: number | null;
  mime_type?: string | null;
};

type BotRow = {
  id: string;
  name: string;
  owner_user_id: string | null;
  vector_store_id?: string | null;
};

type MePayload = {
  plan?: string | null;
  uploads_used?: number;
  uploads_limit?: number | null;
  uploads_remaining?: number | null;
  user?: { email?: string | null };
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function getFetchJsonStatus(e: any): number | undefined {
  return (e as any)?.status ?? (e as any)?.statusCode ?? (e as any)?.response?.status;
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b = b / 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function labelMime(mime: string | null | undefined) {
  if (!mime) return null;
  const m = String(mime).toLowerCase();
  if (m.startsWith("application/pdf")) return "PDF";
  if (m.startsWith("text/plain")) return "TXT";
  if (m.includes("officedocument.wordprocessingml.document")) return "DOCX";
  if (m.startsWith("image/")) return "IMAGE";
  if (m.startsWith("video/")) return "VIDEO";
  return m.toUpperCase();
}

function iconForMime(mime: string | null | undefined) {
  if (!mime) return <FileText className="h-4 w-4" />;
  const m = String(mime).toLowerCase();
  if (m.startsWith("image/")) return <Image className="h-4 w-4" />;
  if (m.startsWith("video/")) return <Video className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
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
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border bg-background/80 p-5 shadow-sm transition hover:-translate-y-[2px] hover:shadow-md">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

const BOT_STORAGE_KEY = "louis.docs.selectedBotId";

export default function DocsPage() {
  const searchParams = useSearchParams();
  const deepLinkedBotId = String(searchParams.get("bot_id") || "").trim();
  const deepLinkedDocId = String(searchParams.get("doc_id") || "").trim();

  const [bots, setBots] = useState<BotRow[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>("");

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string>("");

  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractMsg, setExtractMsg] = useState<string>("");
  const [extractGated, setExtractGated] = useState(false);

  const [plan, setPlan] = useState<string | null>(null);
  const [uploadsUsed, setUploadsUsed] = useState<number>(0);
  const [uploadsLimit, setUploadsLimit] = useState<number | null>(null);
  const [uploadsRemaining, setUploadsRemaining] = useState<number | null>(null);

  const docRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const didApplyQueryBotRef = useRef(false);
  const didScrollToDocRef = useRef(false);

  const planKey = String(plan ?? "").toLowerCase();
  const isProPlus = planKey === "pro" || planKey === "enterprise" || planKey === "corporation";

  const botNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bots) m.set(b.id, b.name);
    return m;
  }, [bots]);

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) ?? null,
    [bots, selectedBotId]
  );

  const isVectorStoreMissing = Boolean(
    selectedBot &&
      Object.prototype.hasOwnProperty.call(selectedBot, "vector_store_id") &&
      (selectedBot.vector_store_id == null || selectedBot.vector_store_id === "")
  );

  const uploadsBlocked = uploadsRemaining !== null && uploadsRemaining <= 0;

  function handleCommonErrors(e: any) {
    if (!isFetchJsonError(e)) return false;
    const status = getFetchJsonStatus(e);
    if (status === 401) {
      window.location.href = "/login";
      return true;
    }
    return false;
  }

  async function refreshMe() {
    try {
      const j = await fetchJson<MePayload>("/api/me", {
        credentials: "include",
        cache: "no-store",
      });

      setPlan(j?.plan ?? null);
      setUploadsUsed(Number(j?.uploads_used ?? 0));
      setUploadsLimit(j?.uploads_limit == null ? null : Number(j.uploads_limit));
      setUploadsRemaining(j?.uploads_remaining == null ? null : Number(j.uploads_remaining));
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
    }
  }

  async function loadBots() {
    try {
      const j = await fetchJson<{ bots?: any[] }>("/api/bots", {
        credentials: "include",
        cache: "no-store",
      });

      const nextBots: BotRow[] = Array.isArray(j?.bots) ? (j.bots as any) : [];
      setBots(nextBots);

      const fromStorage =
        typeof window !== "undefined" ? window.localStorage.getItem(BOT_STORAGE_KEY) : null;

      const initial =
        (fromStorage && nextBots.some((b) => b.id === fromStorage) ? fromStorage : null) ??
        (nextBots[0]?.id ?? "");

      const def = nextBots.find((b) => b.owner_user_id == null)?.id ?? null;
      const queryBot = deepLinkedBotId && nextBots.some((b) => b.id === deepLinkedBotId) ? deepLinkedBotId : null;
      const chosen = queryBot ?? def ?? initial;

      setSelectedBotId((prev) => prev || chosen);
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      setBots([]);
    }
  }

  async function loadDocs(botId: string) {
    if (!botId) {
      setDocs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const qs = `?bot_id=${encodeURIComponent(botId)}`;
      const json = await fetchJson<any>(`/api/documents${qs}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const rows = Array.isArray(json?.documents)
        ? json.documents
        : Array.isArray(json?.docs)
          ? json.docs
          : [];

      const mapped: DocRow[] = rows.map((d: any) => ({
        id: String(d?.id ?? ""),
        filename: String(d?.title ?? d?.filename ?? "Untitled"),
        bot_id: String(d?.bot_id ?? botId),
        openai_file_id: d?.openai_file_id ? String(d.openai_file_id) : null,
        created_at: d?.created_at ? String(d.created_at) : null,
        bytes: d?.bytes == null ? null : Number(d.bytes),
        mime_type: d?.mime_type ? String(d.mime_type) : null,
      }));

      setDocs(mapped.filter((d) => d.id));
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      setError(e?.message ?? "Failed to load documents");
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBots();
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!bots.length) return;
    if (didApplyQueryBotRef.current) return;
    if (!deepLinkedBotId) return;
    if (!bots.some((b) => b.id === deepLinkedBotId)) return;

    didApplyQueryBotRef.current = true;
    setSelectedBotId(deepLinkedBotId);
  }, [bots, deepLinkedBotId]);

  useEffect(() => {
    if (!selectedBotId) return;

    try {
      window.localStorage.setItem(BOT_STORAGE_KEY, selectedBotId);
    } catch {}

    didScrollToDocRef.current = false;
    loadDocs(selectedBotId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBotId]);

  useEffect(() => {
    if (!deepLinkedDocId) return;
    if (loading) return;
    if (didScrollToDocRef.current) return;

    const target = docs.find((d) => d.id === deepLinkedDocId);
    if (!target) return;

    const el = docRefs.current[deepLinkedDocId];
    if (!el) return;

    didScrollToDocRef.current = true;
    window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [deepLinkedDocId, docs, loading]);

  const count = useMemo(() => docs.length, [docs]);

  function startRename(doc: DocRow) {
    setRenamingId(doc.id);
    setRenameDraft(doc.filename);
    setError(null);
    setUploadMsg("");
    setExtractMsg("");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }

  async function saveRename(doc: DocRow) {
    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      setError("Document name cannot be empty");
      return;
    }

    setError(null);

    try {
      await fetchJson(`/api/documents/${encodeURIComponent(doc.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });

      setDocs((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, filename: nextTitle } : d))
      );
      cancelRename();
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      setError(e?.message ?? "Rename failed");
    }
  }

  async function onDelete(doc: DocRow) {
    const ok = window.confirm(`Delete "${doc.filename}"?\n\nThis can’t be undone.`);
    if (!ok) return;

    setDeletingId(doc.id);
    setError(null);

    try {
      await fetchJson(`/api/documents/${encodeURIComponent(doc.id)}`, {
        method: "DELETE",
        credentials: "include",
      });

      await loadDocs(selectedBotId);
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      setError(e?.message ?? "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function onExtract(doc: DocRow) {
    setExtractGated(false);
    setExtractMsg("");
    setUploadMsg("");
    setError(null);

    if (!selectedBotId) {
      setExtractMsg("Pick a bot first.");
      return;
    }

    setExtractingId(doc.id);

    try {
      const json = await fetchJson<any>("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bot_id: selectedBotId,
          document_id: doc.id,
        }),
      });

      const events = Array.isArray(json?.events) ? json.events.length : Number(json?.events_count ?? 0);
      const tasks = Array.isArray(json?.tasks) ? json.tasks.length : Number(json?.tasks_count ?? 0);

      setExtractMsg(
        events || tasks
          ? `Extracted ${events} event${events === 1 ? "" : "s"} and ${tasks} task${tasks === 1 ? "" : "s"}.`
          : "Extraction complete."
      );
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        const status = getFetchJsonStatus(e);
        if (status === 401) {
          window.location.href = "/login";
          return;
        }
        if (status === 403) {
          setExtractGated(true);
          return;
        }
      }
      setExtractMsg(e?.message ?? "Extraction failed");
    } finally {
      setExtractingId(null);
    }
  }

  const uploadAccept = useMemo(() => {
    if (isProPlus) {
      return [
        ".pdf,.txt,.docx",
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/*",
        "video/*",
      ].join(",");
    }
    return [
      ".pdf,.txt,.docx",
      "application/pdf",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].join(",");
  }, [isProPlus]);

  const uploadSupportedLabel = isProPlus
    ? "Supported: PDF, TXT, DOCX, images, video"
    : "Supported: PDF, TXT, DOCX";

  async function onUpload() {
    setUploadMsg("");
    setExtractMsg("");
    setError(null);

    if (!selectedBotId) {
      setUploadMsg("Pick a bot first.");
      return;
    }

    if (uploadsBlocked) {
      setUploadMsg("Daily upload limit reached for your plan.");
      return;
    }

    const file = fileRef.current?.files?.[0] ?? null;
    if (!file) {
      setUploadMsg("Choose a file first.");
      return;
    }

    const name = file.name.toLowerCase();
    const isDoc =
      file.type === "application/pdf" ||
      file.type === "text/plain" ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".pdf") ||
      name.endsWith(".txt") ||
      name.endsWith(".docx");

    const isImage = file.type?.startsWith("image/");
    const isVideo = file.type?.startsWith("video/");

    const okType = isDoc || (isProPlus && (isImage || isVideo));

    if (!okType) {
      setUploadMsg(isProPlus ? "Supported files: PDF, TXT, DOCX, images, video." : "Supported files: PDF, TXT, DOCX.");
      return;
    }

    if (isVectorStoreMissing) {
      setUploadMsg("This bot has no vector store yet. Repair Vector Store is required.");
      return;
    }

    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bot_id", selectedBotId);

      await fetchJson<any>("/api/documents", {
        method: "POST",
        credentials: "include",
        body: fd,
      });

      if (fileRef.current) fileRef.current.value = "";
      setUploadMsg(
        isDoc
          ? "Uploaded and indexed."
          : "Uploaded. (Media search quality may be limited until enhanced indexing is added.)"
      );
      await loadDocs(selectedBotId);
      await refreshMe();
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        const status = getFetchJsonStatus(e);

        if (status === 401) {
          window.location.href = "/login";
          return;
        }

        if (status === 415) {
          setUploadMsg("That file type isn’t allowed on your plan. Upgrade to upload images/video.");
          setUploading(false);
          return;
        }

        if (status === 409) {
          setUploadMsg("This bot has no vector store yet. Click Repair Vector Store above.");
          setUploading(false);
          return;
        }

        if (status === 402) {
          setUploadMsg("OpenAI quota/billing issue. Uploads are temporarily unavailable.");
          setUploading(false);
          return;
        }
      }

      setUploadMsg(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const uploadsBadge =
    uploadsLimit == null
      ? `Uploads: ${uploadsUsed} used (unlimited)`
      : `Uploads: ${uploadsUsed}/${uploadsLimit} used • ${uploadsRemaining ?? 0} left today`;

  if (extractGated) {
    return (
      <UpgradeGate
        title="Extraction is a paid feature"
        message="Upgrade your plan to unlock schedule/to-do extraction from documents."
        ctaHref="/app/billing"
        ctaLabel="Upgrade Plan"
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <section className="relative overflow-hidden rounded-[32px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.10),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Bot knowledge
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">Documents</h1>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Documents are attached to one bot at a time. Upload files, manage knowledge, and run extraction from here.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {plan ? (
                <span className="rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                  Plan: <span className="text-foreground">{prettyPlan(plan)}</span>
                </span>
              ) : null}

              <span className="rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                {uploadsBadge}
              </span>

              {uploadsBlocked ? (
                <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-100">
                  Uploads paused
                </span>
              ) : null}

              {isVectorStoreMissing ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                  Vector store missing
                </span>
              ) : null}

              {deepLinkedDocId ? (
                <span className="rounded-full border bg-primary/10 px-3 py-1 text-xs text-primary">
                  Deep link active
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[280px]">
            <button
              type="button"
              onClick={async () => {
                if (!selectedBotId) return;
                await refreshMe();
                await loadDocs(selectedBotId);
              }}
              className="inline-flex h-11 items-center justify-center rounded-2xl border bg-background/70 px-4 text-sm transition hover:-translate-y-[1px] hover:bg-muted disabled:opacity-50"
              disabled={loading || !selectedBotId}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing..." : "Refresh"}
            </button>

            <Link
              href="/app/billing"
              className="inline-flex h-11 items-center justify-center rounded-2xl border bg-background/70 px-4 text-sm transition hover:-translate-y-[1px] hover:bg-muted"
            >
              Billing
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <TopStat
            label="Selected bot"
            value={selectedBot?.name || "—"}
            hint="Documents are scoped to this bot"
          />
          <TopStat
            label="Documents"
            value={loading ? "—" : String(count)}
            hint="Files currently indexed on this bot"
          />
          <TopStat
            label="Uploads left"
            value={uploadsRemaining == null ? "∞" : String(Math.max(0, uploadsRemaining))}
            hint="Remaining for today"
          />
          <TopStat
            label="Media uploads"
            value={isProPlus ? "On" : "Off"}
            hint={isProPlus ? "Images and video allowed" : "Upgrade for multimedia"}
          />
        </div>
      </section>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${count} document${count === 1 ? "" : "s"} in ${selectedBot?.name || "this bot"}`}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-xs text-muted-foreground">Bot</span>
          <div className="relative" data-tour="docs-bot-selector">
            <Bot className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <select
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
              className="h-11 min-w-[220px] rounded-2xl border bg-background pl-9 pr-4 text-sm outline-none ring-0 transition focus:border-foreground/20 focus:ring-2 focus:ring-ring"
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-100">
          {error}
        </div>
      ) : null}

      {extractMsg ? (
        <div className="rounded-3xl border bg-background p-4 text-sm shadow-sm">{extractMsg}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <div className="rounded-[28px] border bg-card/80 p-5 shadow-sm" data-tour="docs-upload">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <div className="text-lg font-semibold tracking-tight">Upload to this bot</div>
              <div className="mt-1 text-sm text-muted-foreground">{uploadSupportedLabel}</div>

              <div className="mt-4 rounded-3xl border border-dashed bg-muted/25 p-4">
                <input
                  ref={fileRef}
                  type="file"
                  accept={uploadAccept}
                  className="block w-full cursor-pointer rounded-2xl border bg-background px-3 py-5 text-sm transition hover:bg-muted/30"
                  disabled={uploading || !selectedBotId || isVectorStoreMissing || uploadsBlocked}
                />

                {uploadsBlocked ? (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Daily upload limit reached.{" "}
                    <Link href="/app/billing" className="underline">
                      Upgrade
                    </Link>{" "}
                    for more uploads.
                  </div>
                ) : null}

                {isVectorStoreMissing ? (
                  <div className="mt-3 text-xs text-muted-foreground">
                    This bot has no vector store yet. Repair Vector Store before uploading.
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={onUpload}
              disabled={uploading || !selectedBotId || isVectorStoreMissing || uploadsBlocked}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition hover:-translate-y-[1px] hover:opacity-95 disabled:opacity-50"
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>

          {uploadMsg ? (
            <div className="mt-4 rounded-2xl border bg-background p-3 text-sm">{uploadMsg}</div>
          ) : null}
        </div>

        <div className="rounded-[28px] border bg-card/80 p-5 shadow-sm">
          <div className="text-lg font-semibold tracking-tight">Knowledge rules</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Bot scoped</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Every upload belongs to a single bot and only strengthens that bot’s knowledge.
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Plan aware</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Free/Home support docs. Pro and above also support images and video.
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Extraction</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Run extraction on a document to pull schedule events and tasks into the workspace.
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Safe cleanup</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Deleting a document removes it from this bot and clears its attached derived data.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4" data-tour="docs-list">
        {loading ? (
          <div className="rounded-[28px] border bg-card/70 p-8 text-sm text-muted-foreground shadow-sm">
            Loading documents…
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-[28px] border bg-card/70 p-10 shadow-sm">
            <div className="mx-auto flex max-w-md flex-col items-center text-center">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-3xl border bg-background/80">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="mt-4 text-lg font-semibold tracking-tight">No documents yet</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Upload your first document to start building knowledge for this bot.
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {docs.map((doc) => {
              const mimeLabel = labelMime(doc.mime_type);
              const isEditing = renamingId === doc.id;
              const isTargetDoc = !!deepLinkedDocId && doc.id === deepLinkedDocId;

              return (
                <div
                  key={doc.id}
                  ref={(el) => {
                    docRefs.current[doc.id] = el;
                  }}
                  className={[
                    "rounded-[28px] border bg-card/80 p-5 shadow-sm transition hover:-translate-y-[2px] hover:shadow-md",
                    isTargetDoc ? "border-primary ring-2 ring-primary/20" : "",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70">
                          {iconForMime(doc.mime_type)}
                        </span>

                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <div className="space-y-2">
                              <input
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                                maxLength={200}
                                autoFocus
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveRename(doc)}
                                  className="rounded-xl border bg-background/70 px-3 py-1.5 text-xs transition hover:bg-muted"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelRename}
                                  className="rounded-xl border bg-background/70 px-3 py-1.5 text-xs transition hover:bg-muted"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-base font-semibold tracking-tight">
                                  {doc.filename}
                                </div>
                                {isTargetDoc ? (
                                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                                    Linked item
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-1 flex flex-wrap gap-2">
                                {mimeLabel ? (
                                  <span className="rounded-full border bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">
                                    {mimeLabel}
                                  </span>
                                ) : null}

                                <span className="rounded-full border bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">
                                  {formatBytes(doc.bytes)}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div className="rounded-2xl border bg-background/70 px-3 py-2">
                          Bot: {doc.bot_id ? botNameById.get(doc.bot_id) ?? doc.bot_id : "—"}
                        </div>
                        <div className="rounded-2xl border bg-background/70 px-3 py-2">
                          Uploaded: {formatDate(doc.created_at)}
                        </div>
                      </div>

                      {doc.openai_file_id ? (
                        <div className="mt-3 truncate text-xs text-muted-foreground">
                          OpenAI file: {doc.openai_file_id}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {!isEditing ? (
                      <button
                        type="button"
                        onClick={() => startRename(doc)}
                        className="inline-flex items-center rounded-2xl border bg-background/70 px-4 py-2 text-sm transition hover:-translate-y-[1px] hover:bg-muted"
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Rename
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onExtract(doc)}
                      disabled={extractingId === doc.id || !selectedBotId || isEditing}
                      className="rounded-2xl border bg-background/70 px-4 py-2 text-sm transition hover:-translate-y-[1px] hover:bg-muted disabled:opacity-50"
                    >
                      {extractingId === doc.id ? "Extracting..." : "Extract"}
                    </button>

                    <button
                      type="button"
                      onClick={() => onDelete(doc)}
                      disabled={deletingId === doc.id || isEditing}
                      className="rounded-2xl border bg-background/70 px-4 py-2 text-sm transition hover:-translate-y-[1px] hover:bg-muted disabled:opacity-50"
                    >
                      {deletingId === doc.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}