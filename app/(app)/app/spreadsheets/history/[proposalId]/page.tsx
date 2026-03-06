// app/(app)/app/spreadsheets/history/[proposalId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type DetailProposal = {
  id: string;
  status: string;
  instruction: string;
  bot_id: string | null;
  bot_name: string | null;
  created_at: string | null;
  applied_at: string | null;
  applied_by_user_id: string | null;
  csv_snapshot: string;
  title: string;
  notes: string;
  source: string;
  columns: string[];
  rows: string[][];
  updates: Array<{
    row: number;
    col: string;
    old: string | null;
    new: string;
    reason?: string;
  }>;
  row_count: number;
  column_count: number;
};

type SheetLink = {
  proposal_id: string;
  spreadsheet_id: string;
  spreadsheet_name: string | null;
  sheet_name: string | null;
  range_a1: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function safeDateLabel(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function slugifyFilename(s: string) {
  return (s || "spreadsheet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(columns: string[], rows: string[][]) {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = columns.map(esc).join(",");
  const body = rows.map((r) => columns.map((_, i) => esc(r?.[i] ?? "")).join(","));
  return [header, ...body].join("\n");
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

export default function SpreadsheetProposalDetailPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const [proposalId, setProposalId] = useState("");
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const [proposal, setProposal] = useState<DetailProposal | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [acting, setActing] = useState<"APPLY" | "REJECT" | null>(null);
  const [actionMsg, setActionMsg] = useState("");

  const [sheetLink, setSheetLink] = useState<SheetLink | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetMsg, setSheetMsg] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [spreadsheetName, setSpreadsheetName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [rangeA1, setRangeA1] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");
      setActionMsg("");

      try {
        const resolved = await params;
        const id = String(resolved?.proposalId || "").trim();

        if (!id) {
          setError("Missing proposal id.");
          setLoading(false);
          return;
        }

        if (mounted) setProposalId(id);

        const j = await fetchJson<any>(`/api/spreadsheets/history/${encodeURIComponent(id)}`, {
          credentials: "include",
          cache: "no-store",
        });

        if (!mounted) return;

        setPlan(typeof j?.plan === "string" ? j.plan : undefined);
        setUpsell(j?.upsell ?? null);

        const allowed = Boolean(j?.ok) && !j?.upsell?.code;
        setGated(!allowed);

        if (!allowed) {
          setProposal(null);
          return;
        }

        setProposal(j?.proposal ?? null);
      } catch (e: any) {
        if (!mounted) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (isFetchJsonError(e) && e.status === 404) {
          setError("Proposal not found.");
          return;
        }

        setError(e?.message ?? "Failed to load proposal");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [params]);

  async function loadSheetLink(id: string) {
    if (!id) return;

    setSheetLoading(true);
    setSheetError("");
    setSheetMsg("");

    try {
      const j = await fetchJson<any>(`/api/spreadsheets/link-sheet?proposal_id=${encodeURIComponent(id)}`, {
        credentials: "include",
        cache: "no-store",
      });

      const link = (j?.link ?? null) as SheetLink | null;
      setSheetLink(link);

      setSpreadsheetId(link?.spreadsheet_id ?? "");
      setSpreadsheetName(link?.spreadsheet_name ?? "");
      setSheetName(link?.sheet_name ?? "");
      setRangeA1(link?.range_a1 ?? "");
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setSheetError(e?.message ?? "Failed to load linked sheet");
    } finally {
      setSheetLoading(false);
    }
  }

  useEffect(() => {
    if (!proposalId || gated) return;
    loadSheetLink(proposalId).catch(() => {});
  }, [proposalId, gated]);

  const csvText = useMemo(() => {
    if (!proposal) return "";
    if (proposal.source === "csv" && proposal.csv_snapshot) return proposal.csv_snapshot;
    if (proposal.columns.length && proposal.rows.length) return toCsv(proposal.columns, proposal.rows);
    return "";
  }, [proposal]);

  const isPending = String(proposal?.status || "").toLowerCase() === "proposed";

  async function downloadXlsx(title: string, columns: string[], rows: string[][]) {
    const res = await fetch("/api/spreadsheets/export", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, columns, rows }),
    });

    if (!res.ok) {
      let message = "Failed to export XLSX";
      try {
        const j = await res.json();
        message = String(j?.message || j?.error || message);
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyFilename(title || "spreadsheet") || "spreadsheet"}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveSheetLink() {
    if (!proposalId) return;

    setSheetSaving(true);
    setSheetError("");
    setSheetMsg("");

    try {
      const j = await fetchJson<any>("/api/spreadsheets/link-sheet", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposalId,
          spreadsheet_id: spreadsheetId,
          spreadsheet_name: spreadsheetName || undefined,
          sheet_name: sheetName,
          range_a1: rangeA1 || undefined,
        }),
      });

      setSheetMsg(String(j?.message || "Sheet linked to proposal."));
      await loadSheetLink(proposalId);
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (isFetchJsonError(e) && e.status === 400) {
        const msg = String(e?.message || e?.error || "Missing required fields.");
        setSheetError(msg);
        return;
      }
      setSheetError(e?.message ?? "Failed to save sheet link");
    } finally {
      setSheetSaving(false);
    }
  }

  async function runAction(action: "APPLY" | "REJECT") {
    if (!proposalId || !proposal || !isPending) return;

    const ok = window.confirm(
      action === "APPLY"
        ? "Apply this proposal?\n\nThis will record an audit entry."
        : "Reject this proposal?\n\nThis will record an audit entry."
    );
    if (!ok) return;

    setActing(action);
    setActionMsg("");
    setError("");

    try {
      const j = await fetchJson<any>("/api/spreadsheets/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: proposalId,
          action,
        }),
      });

      const nowIso = new Date().toISOString();

      setProposal((prev) =>
        prev
          ? {
              ...prev,
              status: action === "APPLY" ? "applied" : "rejected",
              applied_at: nowIso,
            }
          : prev
      );

      setActionMsg(
        String(
          j?.message ||
            (action === "APPLY"
              ? "Proposal applied and audit log recorded."
              : "Proposal rejected and audit log recorded.")
        )
      );
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setError("Only owner/admin can apply or reject proposals.");
          return;
        }
        if (e.status === 409) {
          setError("This proposal is no longer pending.");
          setProposal((prev) =>
            prev
              ? {
                  ...prev,
                  status: String(prev.status || "proposed").toLowerCase() === "proposed" ? "proposed" : prev.status,
                }
              : prev
          );
          return;
        }
      }
      setError(e?.message ?? `Failed to ${action === "APPLY" ? "apply" : "reject"} proposal`);
    } finally {
      setActing(null);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Spreadsheet details are available on paid plans"
          message={upsell?.message || "Upgrade to view spreadsheet proposal details."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error && !proposal) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Spreadsheet Proposal</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Spreadsheet Proposal</h1>
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">No proposal found.</div>
      </div>
    );
  }

  const showTable = proposal.columns.length > 0 && proposal.rows.length > 0;
  const showUpdates = proposal.updates.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cx(
                "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide",
                sourceBadgeClass(proposal.source)
              )}
            >
              {proposal.source || "unknown"}
            </span>
            <span
              className={cx(
                "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide",
                statusBadgeClass(proposal.status)
              )}
            >
              {proposal.status || "proposed"}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-semibold">{proposal.title || "Spreadsheet proposal"}</h1>

          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {proposal.instruction || "No instruction saved."}
          </p>

          <div className="mt-3 text-xs font-mono text-muted-foreground">{proposalId}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isPending ? (
            <>
              <button
                type="button"
                onClick={() => runAction("APPLY")}
                disabled={acting !== null}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              >
                {acting === "APPLY" ? "Applying..." : "Apply"}
              </button>

              <button
                type="button"
                onClick={() => runAction("REJECT")}
                disabled={acting !== null}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              >
                {acting === "REJECT" ? "Rejecting..." : "Reject"}
              </button>
            </>
          ) : null}

          {csvText ? (
            <button
              type="button"
              onClick={() => {
                const safe = slugifyFilename(proposal.title || "spreadsheet");
                downloadTextFile(`${safe || "spreadsheet"}.csv`, csvText, "text/csv");
              }}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
            >
              Download CSV
            </button>
          ) : null}

          {showTable ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  setExportingXlsx(true);
                  setError("");
                  await downloadXlsx(proposal.title, proposal.columns, proposal.rows);
                } catch (e: any) {
                  setError(e?.message ?? "Failed to export XLSX");
                } finally {
                  setExportingXlsx(false);
                }
              }}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              disabled={exportingXlsx}
            >
              {exportingXlsx ? "Exporting XLSX..." : "Download XLSX"}
            </button>
          ) : null}

          <a
            href="/app/spreadsheets/history"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
          >
            Back to history
          </a>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {actionMsg ? (
        <div className="rounded-lg border bg-emerald-50 p-4 text-sm text-emerald-700">{actionMsg}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Bot</div>
          <div className="mt-3 text-lg font-semibold tracking-tight">{proposal.bot_name || "—"}</div>
          <div className="mt-2 text-xs text-muted-foreground">Linked bot</div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Rows</div>
          <div className="mt-3 text-lg font-semibold tracking-tight">{proposal.row_count}</div>
          <div className="mt-2 text-xs text-muted-foreground">Saved row count</div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Columns</div>
          <div className="mt-3 text-lg font-semibold tracking-tight">{proposal.column_count}</div>
          <div className="mt-2 text-xs text-muted-foreground">Saved column count</div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Created</div>
          <div className="mt-3 text-sm font-semibold tracking-tight">{safeDateLabel(proposal.created_at)}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            Applied: {proposal.applied_at ? safeDateLabel(proposal.applied_at) : "—"}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Linked Google Sheet</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Save the destination sheet for this proposal before real writeback is enabled.
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadSheetLink(proposalId).catch(() => {})}
            disabled={sheetLoading}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
          >
            {sheetLoading ? "Loading..." : "Load linked sheet"}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-sm font-medium">Spreadsheet ID</div>
            <input
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
              placeholder="Google spreadsheet id"
            />
          </div>

          <div>
            <div className="text-sm font-medium">Spreadsheet name</div>
            <input
              value={spreadsheetName}
              onChange={(e) => setSpreadsheetName(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
              placeholder="Optional display name"
            />
          </div>

          <div>
            <div className="text-sm font-medium">Sheet name</div>
            <input
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
              placeholder="Sheet1"
            />
          </div>

          <div>
            <div className="text-sm font-medium">Range A1 (optional)</div>
            <input
              value={rangeA1}
              onChange={(e) => setRangeA1(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
              placeholder="A1:Z500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {sheetLink ? (
              <>
                Linked to <span className="font-medium">{sheetLink.spreadsheet_name || sheetLink.spreadsheet_id}</span>
                {sheetLink.sheet_name ? <> · sheet <span className="font-medium">{sheetLink.sheet_name}</span></> : null}
                {sheetLink.range_a1 ? <> · range <span className="font-medium">{sheetLink.range_a1}</span></> : null}
              </>
            ) : (
              "No sheet linked yet."
            )}
          </div>

          <button
            type="button"
            onClick={() => saveSheetLink().catch(() => {})}
            disabled={sheetSaving}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
          >
            {sheetSaving ? "Saving..." : "Save sheet link"}
          </button>
        </div>

        {sheetError ? (
          <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{sheetError}</div>
        ) : null}

        {sheetMsg ? (
          <div className="rounded-lg border bg-emerald-50 p-4 text-sm text-emerald-700">{sheetMsg}</div>
        ) : null}
      </div>

      {proposal.notes ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold">Notes</div>
          <div className="mt-3 rounded-2xl border bg-background/40 p-4 text-sm">{proposal.notes}</div>
        </div>
      ) : null}

      {showTable ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
          <div>
            <div className="text-base font-semibold">Spreadsheet preview</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Preview of the saved spreadsheet proposal.
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full border-separate border-spacing-y-1 text-left text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  {proposal.columns.map((c, idx) => (
                    <th key={idx} className="px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proposal.rows.length === 0 ? (
                  <tr>
                    <td colSpan={proposal.columns.length || 1} className="px-3 py-3 text-muted-foreground">
                      No rows saved.
                    </td>
                  </tr>
                ) : (
                  proposal.rows.map((r, idx) => (
                    <tr key={idx} className="border-b last:border-b-0">
                      {proposal.columns.map((_, j) => (
                        <td key={j} className="px-3 py-2 align-top text-muted-foreground">
                          {String(r?.[j] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {showUpdates ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
          <div>
            <div className="text-base font-semibold">Proposed CSV updates</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Saved proposal changes for this CSV edit run.
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full border-separate border-spacing-y-1 text-left text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Col</th>
                  <th className="px-3 py-2 font-medium">Old</th>
                  <th className="px-3 py-2 font-medium">New</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {proposal.updates.map((u, idx) => (
                  <tr key={idx} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{u.row}</td>
                    <td className="px-3 py-2 font-mono">{u.col}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.old ?? "—"}</td>
                    <td className="px-3 py-2">{u.new}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!showTable && !showUpdates ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="text-sm text-muted-foreground">No table or updates were saved for this proposal.</div>
        </div>
      ) : null}
    </div>
  );
}