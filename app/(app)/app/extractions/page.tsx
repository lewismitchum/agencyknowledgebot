// app/(app)/app/extractions/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSearch, Pencil, RefreshCw, Trash2 } from "lucide-react";

type ExtractionRunRow = {
  id: string;
  agency_id: string;
  bot_id: string;
  document_id: string;
  title?: string | null;
  display_title?: string | null;
  created_at: string | null;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

async function readJsonSafe(r: Response) {
  const raw = await r.text().catch(() => "");
  let j: any = null;
  try {
    j = raw ? JSON.parse(raw) : null;
  } catch {}
  return { raw, j };
}

export default function ExtractionsPage() {
  const [runs, setRuns] = useState<ExtractionRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");

  const count = useMemo(() => runs.length, [runs]);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const r = await fetch("/api/extractions", { credentials: "include", cache: "no-store" });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const { raw, j } = await readJsonSafe(r);

      if (!r.ok) {
        setError(j?.error || j?.message || raw || `Failed (${r.status})`);
        setRuns([]);
        return;
      }

      const rows = Array.isArray(j?.extractions) ? j.extractions : [];
      const mapped: ExtractionRunRow[] = rows
        .map((x: any) => ({
          id: String(x?.id ?? ""),
          agency_id: String(x?.agency_id ?? ""),
          bot_id: String(x?.bot_id ?? ""),
          document_id: String(x?.document_id ?? ""),
          title: x?.title == null ? null : String(x.title),
          display_title: x?.display_title == null ? null : String(x.display_title),
          created_at: x?.created_at ? String(x.created_at) : null,
        }))
        .filter((x: ExtractionRunRow) => x.id);

      setRuns(mapped);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  function startRename(run: ExtractionRunRow) {
    setRenamingId(run.id);
    setRenameDraft(String(run.title || run.display_title || "Extraction"));
    setError("");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }

  async function onSaveRename(run: ExtractionRunRow) {
    const title = renameDraft.trim();
    if (!title) {
      setError("Name cannot be empty");
      return;
    }

    setError("");

    const prev = runs;
    setRuns((cur) =>
      cur.map((x) =>
        x.id === run.id
          ? {
              ...x,
              title,
              display_title: title,
            }
          : x
      )
    );

    try {
      const r = await fetch("/api/extractions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: run.id, title }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const { raw, j } = await readJsonSafe(r);

      if (!r.ok || !j?.ok) {
        setRuns(prev);
        setError(j?.error || j?.message || raw || `Rename failed (${r.status})`);
        return;
      }

      cancelRename();
    } catch (e: any) {
      setRuns(prev);
      setError(e?.message || "Rename failed");
    }
  }

  async function onDeleteRun(id: string) {
    const ok = window.confirm("Delete this extraction run?\n\nThis only removes the run history, not schedule items.");
    if (!ok) return;

    setDeletingId(id);
    setError("");

    let prev: ExtractionRunRow[] = [];
    setRuns((cur) => {
      prev = cur;
      return cur.filter((x) => x.id !== id);
    });

    try {
      const r = await fetch("/api/extractions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const { raw, j } = await readJsonSafe(r);

      if (!r.ok || !j?.ok) {
        setRuns(prev);
        setError(j?.error || j?.message || raw || `Delete failed (${r.status})`);
        return;
      }
    } catch (e: any) {
      setRuns(prev);
      setError(e?.message || "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <section className="relative overflow-hidden rounded-[32px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.10),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <FileSearch className="h-3.5 w-3.5" />
              Extraction history
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">Extractions</h1>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Review extraction runs, rename them for clarity, and remove old history when needed.
            </p>

            <div className="mt-5 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground inline-flex">
              {loading ? "Loading…" : `${count} run${count === 1 ? "" : "s"}`}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[280px]">
            <button
              onClick={load}
              className="inline-flex h-11 items-center justify-center rounded-2xl border bg-background/70 px-4 text-sm transition hover:-translate-y-[1px] hover:bg-muted disabled:opacity-50"
              disabled={loading}
              type="button"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing..." : "Refresh"}
            </button>

            <Link
              href="/app/docs"
              className="inline-flex h-11 items-center justify-center rounded-2xl border bg-background/70 px-4 text-sm transition hover:-translate-y-[1px] hover:bg-muted"
            >
              Back to docs
            </Link>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <div className="rounded-[28px] border bg-card/80 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-1 text-left text-sm">
            <thead className="border-b bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Bot</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-center text-muted-foreground" colSpan={5}>
                    No extraction runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const isEditing = renamingId === r.id;
                  const displayName = String(r.display_title || r.title || "Extraction");

                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 align-top">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              className="h-10 w-full min-w-[220px] rounded-xl border bg-background px-3 text-sm"
                              maxLength={200}
                              autoFocus
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => onSaveRename(r)}
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
                            <div className="font-medium">{displayName}</div>
                            <div className="text-xs text-muted-foreground">{r.id}</div>
                          </>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top text-muted-foreground">{r.document_id || "—"}</td>
                      <td className="px-4 py-3 align-top text-muted-foreground">{r.bot_id || "—"}</td>
                      <td className="px-4 py-3 align-top text-muted-foreground">{formatDate(r.created_at)}</td>

                      <td className="px-4 py-3 text-right align-top">
                        <div className="flex justify-end gap-2">
                          {!isEditing ? (
                            <button
                              type="button"
                              onClick={() => startRename(r)}
                              className="inline-flex items-center rounded-xl border bg-background/60 px-3 py-1.5 text-sm transition hover:-translate-y-[1px] hover:bg-muted"
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Rename
                            </button>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => onDeleteRun(r.id)}
                            disabled={deletingId === r.id || isEditing}
                            className="inline-flex items-center rounded-xl border bg-background/60 px-3 py-1.5 text-sm transition hover:-translate-y-[1px] hover:bg-muted disabled:opacity-50"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {deletingId === r.id ? "Deleting…" : "Delete"}
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
    </div>
  );
}