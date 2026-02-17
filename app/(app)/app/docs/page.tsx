"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DocRow = {
  id: string;
  filename: string;
  bot_id?: string | null;
  openai_file_id?: string | null;
  created_at: string | null;
  bytes?: number | null;
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

  // Plan / uploads
  const [plan, setPlan] = useState<string | null>(null);
  const [uploadsUsed, setUploadsUsed] = useState<number>(0);
  const [uploadsLimit, setUploadsLimit] = useState<number | null>(null);
  const [uploadsRemaining, setUploadsRemaining] = useState<number | null>(null);

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

  async function refreshMe() {
    try {
      const r = await fetch("/api/me", { credentials: "include" });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!r.ok) return;

      const j = (await r.json().catch(() => null)) as MePayload | null;
      setPlan(j?.plan ?? null);
      setUploadsUsed(Number(j?.uploads_used ?? 0));
      setUploadsLimit(j?.uploads_limit == null ? null : Number(j.uploads_limit));
      setUploadsRemaining(j?.uploads_remaining == null ? null : Number(j.uploads_remaining));
    } catch {}
  }

  async function loadBots() {
    try {
      const r = await fetch("/api/bots", { credentials: "include" });
      const text = await r.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {}

      if (!r.ok) {
        setBots([]);
        return;
      }

      const nextBots: BotRow[] = Array.isArray(j?.bots) ? j.bots : [];
      setBots(nextBots);

      const fromStorage =
        typeof window !== "undefined" ? window.localStorage.getItem(BOT_STORAGE_KEY) : null;

      const initial =
        (fromStorage && nextBots.some((b) => b.id === fromStorage) ? fromStorage : null) ??
        (nextBots[0]?.id ?? "");

      const def = nextBots.find((b) => b.owner_user_id == null)?.id ?? null;
      const chosen = def ?? initial;

      setSelectedBotId((prev) => prev || chosen);
    } catch {
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
      const res = await fetch(`/api/documents${qs}`, {
        method: "GET",
        credentials: "include",
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) {
        setError(json?.error ?? text ?? `Failed to load documents (${res.status})`);
        setDocs([]);
        return;
      }

      setDocs(Array.isArray(json?.docs) ? json.docs : []);
    } catch (e: any) {
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
      const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, {
        method: "DELETE",
        credentials: "include",
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) {
        setError(json?.error ?? text ?? `Delete failed (${res.status})`);
        return;
      }

      await loadDocs(selectedBotId);
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function onRepairVectorStore() {
    if (!selectedBotId) return;

    setRepairing(true);
    setUploadMsg("");
    setError(null);

    try {
      const res = await fetch("/api/fix-vector-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_id: selectedBotId }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) {
        setError(json?.error ?? text ?? `Repair failed (${res.status})`);
        return;
      }

      await loadBots(); // refresh vector_store_id
      await loadDocs(selectedBotId);
      setUploadMsg("Vector store repaired. You can upload now.");
    } catch (e: any) {
      setError(e?.message ?? "Repair failed");
    } finally {
      setRepairing(false);
    }
  }

  async function onUpload() {
    setUploadMsg("");
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

    const okType =
      file.type === "application/pdf" ||
      file.type === "text/plain" ||
      file.name.toLowerCase().endsWith(".docx");

    if (!okType) {
      setUploadMsg("Supported files: PDF, TXT, DOCX.");
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

      const res = await fetch("/api/documents", {
        method: "POST",
        credentials: "include",
        body: fd,
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) {
        // Friendlier, canonical errors
        if (res.status === 403 && json?.error === "DAILY_UPLOAD_LIMIT_EXCEEDED") {
          await refreshMe();
          setUploadMsg(
            `Daily upload limit reached (${json?.used ?? "?"}/${json?.daily_limit ?? "?"}).`
          );
          return;
        }

        if (res.status === 409) {
          setUploadMsg("This bot has no vector store yet. Click Repair Vector Store above.");
          return;
        }

        if (res.status === 402) {
          setUploadMsg("OpenAI quota/billing issue. Uploads are temporarily unavailable.");
          return;
        }

        const msg = json?.error ?? json?.message ?? text ?? `Upload failed (${res.status})`;
        setUploadMsg(msg);
        return;
      }

      if (fileRef.current) fileRef.current.value = "";
      setUploadMsg("Uploaded and indexed.");
      await loadDocs(selectedBotId);
      await refreshMe();
    } catch (e: any) {
      setUploadMsg(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const uploadsBadge =
    uploadsLimit == null
      ? `Uploads: ${uploadsUsed} used (unlimited)`
      : `Uploads: ${uploadsUsed}/${uploadsLimit} used • ${uploadsRemaining ?? 0} left today`;

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

          <a
            href="/app/settings/billing"
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
          >
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
            Vector store is missing for <span className="font-medium">{selectedBot?.name}</span>.
            Repair it, then upload.
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
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mb-4 rounded-lg border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <div className="text-sm font-medium">Upload</div>
            <div className="text-xs text-muted-foreground">Supported: PDF, TXT, DOCX</div>

            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="mt-2 block w-full text-sm"
              disabled={uploading || !selectedBotId || isVectorStoreMissing || uploadsBlocked}
            />

            {uploadsBlocked ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Daily upload limit reached.{" "}
                <a href="/app/settings/billing" className="underline">
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

        {uploadMsg ? (
          <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">{uploadMsg}</div>
        ) : null}
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
                docs.map((doc) => (
                  <tr key={doc.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{doc.filename}</div>
                      {doc.openai_file_id ? (
                        <div className="text-xs text-muted-foreground">
                          OpenAI file: {doc.openai_file_id}
                        </div>
                      ) : null}
                    </td>

                    <td className="px-4 py-3 text-muted-foreground">
                      {doc.bot_id ? botNameById.get(doc.bot_id) ?? doc.bot_id : "—"}
                    </td>

                    <td className="px-4 py-3 text-muted-foreground">{formatBytes(doc.bytes)}</td>

                    <td className="px-4 py-3 text-muted-foreground">{formatDate(doc.created_at)}</td>

                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete(doc)}
                        disabled={deletingId === doc.id}
                        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                      >
                        {deletingId === doc.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Deleting should remove both the database record and the vector-store file (handled server-side in the DELETE
        route).
      </p>
    </div>
  );
}
