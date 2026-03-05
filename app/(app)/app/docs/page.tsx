"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

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

const BOT_STORAGE_KEY = "louis.docs.selectedBotId";

export default function DocsPage() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>("");

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Upload state
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string>("");

  // Repair state
  const [repairing, setRepairing] = useState(false);

  // Extraction state
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractMsg, setExtractMsg] = useState<string>("");
  const [extractGated, setExtractGated] = useState(false);

  // Plan / uploads
  const [plan, setPlan] = useState<string | null>(null);
  const [uploadsUsed, setUploadsUsed] = useState<number>(0);
  const [uploadsLimit, setUploadsLimit] = useState<number | null>(null);
  const [uploadsRemaining, setUploadsRemaining] = useState<number | null>(null);

  const planKey = String(plan ?? "").toLowerCase();
  const isProPlus = planKey === "pro" || planKey === "enterprise" || planKey === "corporation";

  const botNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bots) m.set(b.id, b.name);
    return m;
  }, [bots]);

  const defaultBot = useMemo(() => bots.find((b) => b.owner_user_id == null) ?? null, [bots]);

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
      // ignore
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
      const chosen = def ?? initial;

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
  }, []);

  useEffect(() => {
    if (!selectedBotId) return;

    try {
      window.localStorage.setItem(BOT_STORAGE_KEY, selectedBotId);
    } catch {}

    loadDocs(selectedBotId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBotId]);

  const count = useMemo(() => docs.length, [docs]);

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

  async function onRepairVectorStore() {
    if (!selectedBotId) return;

    setRepairing(true);
    setUploadMsg("");
    setExtractMsg("");
    setError(null);

    try {
      await fetchJson("/api/fix-vector-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_id: selectedBotId }),
      });

      await loadBots(); // refresh vector_store_id
      await loadDocs(selectedBotId);
      setUploadMsg("Vector store repaired. You can upload now.");
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      setError(e?.message ?? "Repair failed");
    } finally {
      setRepairing(false);
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

        // Upload limit
        if (status === 403) {
          const code = String((e as any).code || "").toUpperCase();
          const bodyErr = String(((e as any).body && (((e as any).body.error || (e as any).body.code)) ) || "").toUpperCase();

          if (code === "DAILY_UPLOAD_LIMIT_EXCEEDED" || bodyErr === "DAILY_UPLOAD_LIMIT_EXCEEDED") {
            await refreshMe();
            const used = (e as any).body?.used ?? "?";
            const daily = (e as any).body?.daily_limit ?? "?";
            setUploadMsg(`Daily upload limit reached (${used}/${daily}).`);
            setUploading(false);
            return;
          }
        }

        // vector_store missing on server
        if (status === 409) {
          setUploadMsg("This bot has no vector store yet. Click Repair Vector Store above.");
          setUploading(false);
          return;
        }

        // OpenAI billing/quota
        if (status === 402) {
          setUploadMsg("OpenAI quota/billing issue. Uploads are temporarily unavailable.");
          setUploading(false);
          return;
        }

        if (status === 401) {
          window.location.href = "/login";
          return;
        }

        // MIME blocked by plan (server-side truth)
        if (status === 415) {
          setUploadMsg("That file type isn’t allowed on your plan. Upgrade to upload images/video.");
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
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Documents are scoped to a single bot. Choose a bot, upload docs, and manage them here.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {defaultBot ? (
              <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                Default bot: <span className="text-foreground">{defaultBot.name}</span>
              </span>
            ) : null}

            {plan ? (
              <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                Plan: <span className="text-foreground">{plan}</span>
              </span>
            ) : null}

            <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
              {uploadsBadge}
            </span>

            {uploadsBlocked ? (
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">
                Uploads paused (daily limit)
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!selectedBotId) return;
              await refreshMe();
              await loadDocs(selectedBotId);
            }}
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            disabled={loading || !selectedBotId}
          >
            Refresh
          </button>

          <a href="/app/billing" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Billing
          </a>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${count} document${count === 1 ? "" : "s"}`}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Bot:</span>
          <select
            value={selectedBotId}
            onChange={(e) => setSelectedBotId(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isVectorStoreMissing ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-medium">This bot can’t accept uploads yet.</div>
          <div className="mt-1">
            Vector store is missing for <span className="font-medium">{selectedBot?.name}</span>. Repair it, then upload.
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={onRepairVectorStore}
              disabled={repairing || !selectedBotId}
              className="rounded-md bg-amber-700 px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {repairing ? "Repairing…" : "Repair Vector Store"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {extractMsg ? <div className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">{extractMsg}</div> : null}

      <div className="mb-4 rounded-lg border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <div className="text-sm font-medium">Upload</div>
            <div className="text-xs text-muted-foreground">{uploadSupportedLabel}</div>

            <input
              ref={fileRef}
              type="file"
              accept={uploadAccept}
              className="mt-2 block w-full text-sm"
              disabled={uploading || !selectedBotId || isVectorStoreMissing || uploadsBlocked}
            />

            {uploadsBlocked ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Daily upload limit reached.{" "}
                <a href="/app/billing" className="underline">
                  Upgrade
                </a>{" "}
                for more uploads.
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onUpload}
            disabled={uploading || !selectedBotId || isVectorStoreMissing || uploadsBlocked}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>

        {uploadMsg ? <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">{uploadMsg}</div> : null}
      </div>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-4 py-3 font-medium">Filename</th>
                <th className="px-4 py-3 font-medium">Bot</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                    Loading documents…
                  </td>
                </tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                    No documents for this bot yet.
                  </td>
                </tr>
              ) : (
                docs.map((doc) => {
                  const mimeLabel = labelMime(doc.mime_type);
                  return (
                    <tr key={doc.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">{doc.filename}</div>
                          {mimeLabel ? (
                            <span className="rounded-full border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                              {mimeLabel}
                            </span>
                          ) : null}
                        </div>
                        {doc.openai_file_id ? (
                          <div className="text-xs text-muted-foreground">OpenAI file: {doc.openai_file_id}</div>
                        ) : null}
                      </td>

                      <td className="px-4 py-3 text-muted-foreground">
                        {doc.bot_id ? botNameById.get(doc.bot_id) ?? doc.bot_id : "—"}
                      </td>

                      <td className="px-4 py-3 text-muted-foreground">{formatBytes(doc.bytes)}</td>

                      <td className="px-4 py-3 text-muted-foreground">{formatDate(doc.created_at)}</td>

                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => onExtract(doc)}
                            disabled={extractingId === doc.id || !selectedBotId}
                            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                            title="Extract schedule events / tasks from this document"
                          >
                            {extractingId === doc.id ? "Extracting…" : "Extract"}
                          </button>

                          <button
                            type="button"
                            onClick={() => onDelete(doc)}
                            disabled={deletingId === doc.id}
                            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                          >
                            {deletingId === doc.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Deleting should remove both the database record and the vector-store file (handled server-side in the DELETE route).
      </p>
    </div>
  );
}