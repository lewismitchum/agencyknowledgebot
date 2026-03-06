// app/(app)/app/spreadsheets/history/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type HistoryStatus = "proposed" | "applied" | "rejected";
type HistorySource = "docs" | "csv" | "ai" | "unknown";

type HistoryRow = {
  id: string;
  status: string;
  source: string;
  title: string;
  instruction: string;
  bot_id: string | null;
  bot_name: string | null;
  created_at: string | null;
  applied_at: string | null;
  applied_by_user_id: string | null;
  row_count: number;
  column_count: number;
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function safeDateLabel(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusBadgeClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "applied") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (s === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function sourceBadgeClass(source: string) {
  const s = String(source || "").toLowerCase();
  if (s === "docs") return "border-blue-200 bg-blue-50 text-blue-700";
  if (s === "csv") return "border-violet-200 bg-violet-50 text-violet-700";
  if (s === "ai") return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700";
  return "border-muted bg-muted/50 text-muted-foreground";
}

export default function SpreadsheetHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const [status, setStatus] = useState<"all" | HistoryStatus>("all");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const filteredRows = useMemo(() => {
    if (status === "all") return rows;
    return rows.filter((r) => String(r.status).toLowerCase() === status);
  }, [rows, status]);

  async function loadHistory(nextStatus?: "all" | HistoryStatus, silent?: boolean) {
    const currentStatus = nextStatus ?? status;

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const qs =
        currentStatus === "all"
          ? "/api/spreadsheets/history"
          : `/api/spreadsheets/history?status=${encodeURIComponent(currentStatus)}`;

      const j = await fetchJson<any>(qs, {
        credentials: "include",
        cache: "no-store",
      });

      setPlan(typeof j?.plan === "string" ? j.plan : undefined);
      setUpsell(j?.upsell ?? null);

      const allowed = Boolean(j?.ok) && !j?.upsell?.code;
      setGated(!allowed);

      if (!allowed) {
        setRows([]);
        return;
      }

      setRows(Array.isArray(j?.history) ? (j.history as HistoryRow[]) : []);
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setError(e?.message ?? "Failed to load spreadsheet history");
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadHistory(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (loading) return <div className="p-6">Loading...</div>;

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Spreadsheet history is available on paid plans"
          message={upsell?.message || "Upgrade to unlock spreadsheet history and saved proposal tracking."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Spreadsheet History</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Spreadsheet History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View saved spreadsheet runs and proposal status. Plan:{" "}
            <span className="font-mono">{plan ?? "unknown"}</span>
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:w-[180px]">
            <div className="text-sm font-medium">Status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | HistoryStatus)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
            >
              <option value="all">All</option>
              <option value="proposed">Proposed</option>
              <option value="applied">Applied</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => loadHistory(status, true)}
            className="h-11 rounded-xl border px-4 text-sm hover:bg-muted disabled:opacity-60"
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Total</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">{rows.length}</div>
          <div className="mt-2 text-xs text-muted-foreground">Saved spreadsheet proposals</div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Proposed</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">
            {rows.filter((r) => String(r.status).toLowerCase() === "proposed").length}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Awaiting review or apply</div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Applied</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">
            {rows.filter((r) => String(r.status).toLowerCase() === "applied").length}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Marked as applied</div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Rejected</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">
            {rows.filter((r) => String(r.status).toLowerCase() === "rejected").length}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Rejected proposals</div>
        </div>
      </div>

      <div className="rounded-3xl border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <div className="text-base font-semibold">Saved proposals</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Generated from docs, CSV edits, and AI spreadsheet runs.
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium">No spreadsheet history yet</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Generate a spreadsheet or create a CSV proposal and it will appear here.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Bot</th>
                  <th className="px-5 py-3 font-medium">Rows / Cols</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-5 py-4 align-top">
                      <a
                        href={`/app/spreadsheets/history/${encodeURIComponent(row.id)}`}
                        className="font-medium transition hover:text-foreground/80 hover:underline"
                      >
                        {row.title || "Spreadsheet proposal"}
                      </a>
                      <div className="mt-1 max-w-[360px] truncate text-xs text-muted-foreground">
                        {row.instruction || row.id}
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-muted-foreground">{row.id}</div>
                    </td>

                    <td className="px-5 py-4 align-top">
                      <span
                        className={cx(
                          "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide",
                          sourceBadgeClass(row.source)
                        )}
                      >
                        {row.source || "unknown"}
                      </span>
                    </td>

                    <td className="px-5 py-4 align-top">
                      <span
                        className={cx(
                          "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide",
                          statusBadgeClass(row.status)
                        )}
                      >
                        {row.status || "proposed"}
                      </span>
                    </td>

                    <td className="px-5 py-4 align-top text-muted-foreground">
                      {row.bot_name || "—"}
                    </td>

                    <td className="px-5 py-4 align-top text-muted-foreground">
                      {row.row_count} / {row.column_count}
                    </td>

                    <td className="px-5 py-4 align-top text-muted-foreground">
                      {safeDateLabel(row.created_at)}
                    </td>

                    <td className="px-5 py-4 align-top text-muted-foreground">
                      {row.applied_at ? safeDateLabel(row.applied_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}