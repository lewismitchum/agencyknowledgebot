"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ExtractionRow = {
  id: string;
  type: "event" | "task";
  title: string;
  start_at: string | null;
  end_at: string | null;
  due_at: string | null;
  confidence: number | null;
  source_excerpt: string | null;
  document_id: string | null;
  bot_id: string | null;
  created_at: string | null;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function ExtractionsPage() {
  const [rows, setRows] = useState<ExtractionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/extractions", { credentials: "include" });
      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!r.ok) {
        setError(j?.error || raw || `Failed (${r.status})`);
        setRows([]);
        return;
      }

      setRows(Array.isArray(j?.items) ? j.items : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Extractions</h1>
          <p className="text-sm text-muted-foreground">
            Events & tasks extracted from your documents (dev preview).
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
          <Link
            href="/app/docs"
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
          >
            Back to docs
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Confidence</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                    No extractions yet. Run “Extract” on a document from Docs.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const when =
                    r.type === "event"
                      ? `${r.start_at ?? "—"} → ${r.end_at ?? "—"}`
                      : `Due: ${r.due_at ?? "—"}`;

                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{r.type}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.title}</div>
                        {r.source_excerpt ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {r.source_excerpt}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{when}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.confidence == null ? "—" : String(r.confidence)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(r.created_at)}
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
