// app/(app)/app/spreadsheets/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type ProposalUpdate = {
  row: number;
  col: string;
  old: string | null;
  new: string;
  reason?: string;
};

type Proposal = {
  updates: ProposalUpdate[];
  notes?: string;
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

export default function SpreadsheetsPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const [csv, setCsv] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalError, setProposalError] = useState<string>("");

  const canPropose = useMemo(() => {
    return csv.trim().length > 0 && instruction.trim().length > 0 && !proposing;
  }, [csv, instruction, proposing]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGated(false);
      setError("");

      try {
        const j = await fetchJson<any>("/api/spreadsheets", { credentials: "include", cache: "no-store" });

        if (cancelled) return;

        setPlan(typeof j?.plan === "string" ? j.plan : undefined);
        setUpsell(j?.upsell ?? null);

        const allowed = Boolean(j?.ok) && !j?.upsell?.code;
        setGated(!allowed);
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load spreadsheets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onPropose() {
    if (!canPropose) return;

    setProposing(true);
    setProposal(null);
    setProposalError("");

    try {
      const j = await fetchJson<any>("/api/spreadsheets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, instruction }),
      });

      const p = j?.proposal ?? null;
      const updates = Array.isArray(p?.updates) ? p.updates : [];
      setProposal({
        updates: updates as ProposalUpdate[],
        notes: typeof p?.notes === "string" ? p.notes : "",
      });
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setProposalError("Upgrade required to use spreadsheet proposals.");
          return;
        }
      }
      setProposalError(e?.message ?? "Failed to generate proposal");
    } finally {
      setProposing(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Spreadsheets are available on paid plans"
          message={upsell?.message || "Upgrade to unlock spreadsheet AI proposals and updates."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Spreadsheets</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Spreadsheets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Propose edits first (audit-friendly). Plan: <span className="font-mono">{plan ?? "unknown"}</span>
        </p>
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
        <div>
          <div className="text-sm font-medium">1) Paste CSV snapshot</div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            className="mt-2 w-full rounded-xl border bg-background/40 p-3 font-mono text-xs"
            placeholder="Paste CSV here (export from Google Sheets for now)."
          />
          <div className="mt-2 text-xs text-muted-foreground">
            This is proposal-only. No updates are applied yet.
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">2) Describe the change</div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
            placeholder='Example: "Set Status=Paid for all rows where Invoice ID is not empty. Add a Due Date of 2026-03-15 for Client=Acme."'
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onPropose}
            disabled={!canPropose}
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
          >
            {proposing ? "Proposing..." : "Propose edits"}
          </button>

          <div className="text-xs text-muted-foreground">
            Apply is coming next (with approvals + audit log).
          </div>
        </div>

        {proposalError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{proposalError}</div>
        ) : null}
      </div>

      {proposal ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Proposed edits</div>
              <div className="text-xs text-muted-foreground">
                {proposal.updates.length} change{proposal.updates.length === 1 ? "" : "s"}
              </div>
            </div>

            <button
              type="button"
              disabled
              className="rounded-xl border px-4 py-2 text-sm text-muted-foreground opacity-60 cursor-not-allowed"
              title="Coming next: approvals + apply + audit log"
            >
              Apply (coming soon)
            </button>
          </div>

          {proposal.notes ? (
            <div className="rounded-xl border bg-background/40 p-3 text-sm">{proposal.notes}</div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Col</th>
                  <th className="px-3 py-2 font-medium">Old</th>
                  <th className="px-3 py-2 font-medium">New</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {proposal.updates.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-muted-foreground">
                      No safe edits proposed. Try a more specific instruction.
                    </td>
                  </tr>
                ) : (
                  proposal.updates.map((u, idx) => (
                    <tr key={idx} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{u.row}</td>
                      <td className="px-3 py-2 font-mono">{u.col}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.old ?? "—"}</td>
                      <td className="px-3 py-2">{u.new}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.reason ?? ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}