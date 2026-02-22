"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ExtractionRunRow = {
  id: string;
  agency_id: string;
  bot_id: string;
  document_id: string;
  created_at: string | null;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function ExtractionsPage() {
  const [runs, setRuns] = useState<ExtractionRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const count = useMemo(() => runs.length, [runs]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/extractions", { credentials: "include", cache: "no-store" });
      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

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

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Extractions</h1>
          <p className="text-sm text-muted-foreground">
            Extraction runs (each time you clicked “Extract” on a document).
          </p>
          <div className="mt-2 text-sm text-muted-foreground">
            {loading ? "Loading…" : `${count} run${count === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
          <Link href="/app/docs" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
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
                <th className="px-4 py-3 font-medium">Run ID</th>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Bot</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={4}>
                    Loading…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-muted-foreground" colSpan={4}>
                    No extraction runs yet. Click “Extract” on a document from Docs.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.id}</div>
                      <div className="text-xs text-muted-foreground">Agency: {r.agency_id}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.document_id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.bot_id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(r.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Note: This page lists extraction runs. Extracted events/tasks appear in Schedule.
      </p>
    </div>
  );
}