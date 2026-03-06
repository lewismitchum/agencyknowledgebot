// app/(app)/app/spreadsheets/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type Bot = {
  id: string;
  name: string;
  owner_user_id?: string | null;
};

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

type GeneratedTable = {
  title: string;
  columns: string[];
  rows: string[][];
  notes?: string;
};

type GenColumn = {
  key: string;
  label?: string;
  type?: "text" | "number" | "date" | "currency" | "boolean" | string;
};

type SpreadsheetMode = "docs" | "csv" | "ai";

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
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

function slugifyFilename(s: string) {
  return (s || "spreadsheet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function toRowArrays(columns: GenColumn[], rows: Array<Record<string, any>>): string[][] {
  const keys = columns.map((c) => String(c.key || "").trim()).filter(Boolean);
  return (rows || []).map((r) => keys.map((k) => (r?.[k] === null || r?.[k] === undefined ? "" : String(r[k]))));
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function ModeActionMenu({
  mode,
  setMode,
}: {
  mode: SpreadsheetMode;
  setMode: (mode: SpreadsheetMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }

    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);

    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const label =
    mode === "docs" ? "Generate from docs" : mode === "csv" ? "CSV edits" : "Generate from AI";

  return (
    <div ref={wrapRef} className="relative w-full md:w-[280px]">
      <div className="text-sm font-medium">Spreadsheet action</div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 flex h-11 w-full items-center justify-between rounded-xl border bg-background/40 px-3 text-sm transition hover:bg-background/70"
      >
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-full overflow-hidden rounded-2xl border bg-background shadow-xl">
          <button
            type="button"
            onClick={() => {
              setMode("docs");
              setOpen(false);
            }}
            className={cx(
              "flex w-full items-start px-4 py-3 text-left text-sm transition hover:bg-muted/60",
              mode === "docs" && "bg-muted/50"
            )}
          >
            <div>
              <div className="font-medium">Generate from docs</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Build a spreadsheet from uploaded workspace knowledge.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("csv");
              setOpen(false);
            }}
            className={cx(
              "flex w-full items-start border-t px-4 py-3 text-left text-sm transition hover:bg-muted/60",
              mode === "csv" && "bg-muted/50"
            )}
          >
            <div>
              <div className="font-medium">CSV edits</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Paste a CSV snapshot and propose safe AI edits.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("ai");
              setOpen(false);
            }}
            className={cx(
              "flex w-full items-start border-t px-4 py-3 text-left text-sm transition hover:bg-muted/60",
              mode === "ai" && "bg-muted/50"
            )}
          >
            <div>
              <div className="font-medium">Generate from AI</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Create a starter spreadsheet from a prompt instantly.
              </div>
            </div>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function SpreadsheetsPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const [mode, setMode] = useState<SpreadsheetMode>("docs");
  const [canApply, setCanApply] = useState(false);

  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState<string>("");

  // docs generation
  const [genPrompt, setGenPrompt] = useState("");
  const [genColumns, setGenColumns] = useState("");
  const [genMaxRows, setGenMaxRows] = useState<number>(200);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [genFallback, setGenFallback] = useState<string | null>(null);
  const [genTable, setGenTable] = useState<GeneratedTable | null>(null);
  const [genCsv, setGenCsv] = useState<string>("");
  const [genProposalId, setGenProposalId] = useState<string | null>(null);
  const [genExportingXlsx, setGenExportingXlsx] = useState(false);

  // csv edits
  const [csv, setCsv] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string>("");

  // ai generation
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiColumns, setAiColumns] = useState("");
  const [aiMaxRows, setAiMaxRows] = useState<number>(100);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiTable, setAiTable] = useState<GeneratedTable | null>(null);
  const [aiCsv, setAiCsv] = useState("");
  const [aiProposalId, setAiProposalId] = useState<string | null>(null);
  const [aiExportingXlsx, setAiExportingXlsx] = useState(false);

  const canGenerate = useMemo(() => {
    return botId.trim().length > 0 && genPrompt.trim().length > 0 && !generating;
  }, [botId, genPrompt, generating]);

  const canPropose = useMemo(() => {
    return csv.trim().length > 0 && instruction.trim().length > 0 && !proposing;
  }, [csv, instruction, proposing]);

  const canApplyNow = useMemo(() => {
    return Boolean(canApply && proposalId && proposal && proposal.updates.length > 0 && !applying);
  }, [canApply, proposalId, proposal, applying]);

  const canGenerateAi = useMemo(() => {
    return aiPrompt.trim().length > 0 && !aiGenerating;
  }, [aiPrompt, aiGenerating]);

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
        setCanApply(Boolean(j?.can_apply));

        const allowed = Boolean(j?.ok) && !j?.upsell?.code;
        setGated(!allowed);

        if (allowed) {
          try {
            const b = await fetchJson<any>("/api/bots", { credentials: "include", cache: "no-store" });
            const list = Array.isArray(b?.bots) ? b.bots : Array.isArray(b) ? b : [];
            const parsed: Bot[] = list
              .map((x: any) => ({
                id: String(x?.id || ""),
                name: String(x?.name || "Bot"),
                owner_user_id: x?.owner_user_id ?? null,
              }))
              .filter((x: Bot) => x.id);

            if (cancelled) return;

            setBots(parsed);

            if (!botId) {
              const agency = parsed.find((x) => !x.owner_user_id) ?? parsed[0];
              if (agency?.id) setBotId(agency.id);
            }
          } catch {
            if (!cancelled) setBots([]);
          }
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function onGenerate() {
    if (!canGenerate) return;

    setGenerating(true);
    setGenError("");
    setGenFallback(null);
    setGenTable(null);
    setGenCsv("");
    setGenProposalId(null);

    try {
      const cols = genColumns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 40);

      const payload: any = {
        bot_id: botId,
        prompt: genPrompt,
        max_rows: Number.isFinite(genMaxRows) ? Math.max(1, Math.min(500, genMaxRows)) : 200,
      };

      if (cols.length) payload.columns = cols;

      const j = await fetchJson<any>("/api/spreadsheets/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (j?.fallback || j?.insufficient_evidence) {
        setGenFallback(String(j?.message || j?.fallback || "I don’t have that information in the docs yet."));
        return;
      }

      const colsObj = Array.isArray(j?.columns) ? (j.columns as GenColumn[]) : null;
      const rowsObj = Array.isArray(j?.rows) ? (j.rows as Array<Record<string, any>>) : null;

      if (!colsObj || !rowsObj || colsObj.length === 0) {
        setGenFallback("I don’t have that information in the docs yet.");
        return;
      }

      const displayCols = colsObj.map((c) => String(c?.label || c?.key || "").trim()).filter(Boolean);
      const rowArrays = toRowArrays(colsObj, rowsObj);

      setGenTable({
        title: typeof j?.title === "string" && j.title.trim() ? j.title : "Generated Spreadsheet",
        columns: displayCols.length ? displayCols : colsObj.map((c) => String(c.key)),
        rows: rowArrays,
        notes: typeof j?.notes === "string" ? j.notes : "",
      });

      setGenCsv(typeof j?.csv === "string" ? j.csv : "");
      setGenProposalId(typeof j?.proposal_id === "string" ? j.proposal_id : null);
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setGenError("Upgrade required to generate spreadsheets from docs.");
          return;
        }
        if (e.status === 409) {
          setGenError("This bot is missing a vector store. Repair it in Bots first.");
          return;
        }
      }
      setGenError(e?.message ?? "Failed to generate spreadsheet");
    } finally {
      setGenerating(false);
    }
  }

  async function onPropose() {
    if (!canPropose) return;

    setProposing(true);
    setProposal(null);
    setProposalId(null);
    setProposalError("");
    setApplyMsg("");

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

      const pid = typeof j?.proposal_id === "string" ? j.proposal_id : null;
      setProposalId(pid);
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

  async function onApply() {
    if (!canApplyNow || !proposalId) return;

    const ok = window.confirm("Apply this proposal?\n\nThis will write an immutable audit entry.");
    if (!ok) return;

    setApplying(true);
    setApplyMsg("");
    setProposalError("");

    try {
      const j = await fetchJson<any>("/api/spreadsheets/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_id: proposalId, action: "APPLY" }),
      });

      if (j?.ok) {
        setApplyMsg(j?.message || "Applied (audit log recorded). Real sheet writes are coming next.");
      } else {
        setApplyMsg("Applied.");
      }
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setApplyMsg("Only owner/admin can apply proposals.");
          return;
        }
        if (e.status === 409) {
          setApplyMsg("This proposal is no longer pending.");
          return;
        }
      }
      setApplyMsg(e?.message ?? "Failed to apply proposal");
    } finally {
      setApplying(false);
    }
  }

  async function onGenerateAi() {
    if (!canGenerateAi) return;

    setAiGenerating(true);
    setAiError("");
    setAiTable(null);
    setAiCsv("");
    setAiProposalId(null);

    try {
      const cols = aiColumns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);

      const payload: any = {
        prompt: aiPrompt,
        max_rows: Number.isFinite(aiMaxRows) ? Math.max(1, Math.min(200, aiMaxRows)) : 100,
      };

      if (cols.length) payload.columns = cols;

      const j = await fetchJson<any>("/api/spreadsheets/ai-generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const colsObj = Array.isArray(j?.columns) ? (j.columns as GenColumn[]) : null;
      const rowsObj = Array.isArray(j?.rows) ? (j.rows as Array<Record<string, any>>) : null;

      if (!colsObj || !rowsObj || colsObj.length === 0 || rowsObj.length === 0) {
        setAiError("Failed to generate AI spreadsheet");
        return;
      }

      const displayCols = colsObj.map((c) => String(c?.label || c?.key || "").trim()).filter(Boolean);
      const rowArrays = toRowArrays(colsObj, rowsObj);

      setAiTable({
        title: typeof j?.title === "string" && j.title.trim() ? j.title : "AI Spreadsheet Draft",
        columns: displayCols.length ? displayCols : colsObj.map((c) => String(c.key)),
        rows: rowArrays,
        notes: typeof j?.notes === "string" ? j.notes : "",
      });

      setAiCsv(typeof j?.csv === "string" ? j.csv : "");
      setAiProposalId(typeof j?.proposal_id === "string" ? j.proposal_id : null);
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setAiError("Upgrade required to generate AI spreadsheets.");
          return;
        }
        if (e.status === 400) {
          setAiError("Missing prompt.");
          return;
        }
      }
      setAiError(e?.message ?? "Failed to generate AI spreadsheet");
    } finally {
      setAiGenerating(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Spreadsheets are available on paid plans"
          message={upsell?.message || "Upgrade to unlock spreadsheet AI generation and proposals."}
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
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Spreadsheets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One menu for docs generation, CSV edits, or AI generation. Plan:{" "}
            <span className="font-mono">{plan ?? "unknown"}</span>
          </p>
        </div>

        <ModeActionMenu mode={mode} setMode={setMode} />
      </div>

      {mode === "docs" ? (
        <div className="space-y-6">
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Generate from docs</div>
                <div className="text-xs text-muted-foreground">
                  Louis will only use evidence found via file_search. If docs don’t support it, you’ll get the fallback.
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium">Bot</div>
                <select
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                >
                  {bots.length === 0 ? <option value="">No bots found</option> : null}
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.owner_user_id ? " (Private)" : " (Agency)"}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-muted-foreground">Generation uses this bot’s vector store.</div>
              </div>

              <div>
                <div className="text-sm font-medium">Max rows</div>
                <input
                  value={String(genMaxRows)}
                  onChange={(e) => setGenMaxRows(Number(e.target.value))}
                  type="number"
                  min={1}
                  max={500}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                />
                <div className="mt-2 text-xs text-muted-foreground">Capped at 500.</div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">What spreadsheet do you want?</div>
              <textarea
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
                placeholder='Example: "Make a client onboarding checklist table with columns: Step, Owner, SLA, Link, Notes. Use our SOP docs."'
              />
            </div>

            <div>
              <div className="text-sm font-medium">Optional required columns (comma-separated)</div>
              <input
                value={genColumns}
                onChange={(e) => setGenColumns(e.target.value)}
                className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                placeholder="Step, Owner, SLA, Link, Notes"
              />
              <div className="mt-2 text-xs text-muted-foreground">If set, the model should conform to these columns.</div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {generating ? "Generating..." : "Generate spreadsheet"}
              </button>

              <div className="text-xs text-muted-foreground">
                {genProposalId ? (
                  <>
                    Proposal: <span className="font-mono">{genProposalId}</span>
                  </>
                ) : (
                  "Creates an auditable proposal record."
                )}
              </div>
            </div>

            {genError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{genError}</div>
            ) : null}

            {genFallback ? (
              <div className="rounded-xl border bg-muted/40 p-3 text-sm font-mono">{genFallback}</div>
            ) : null}
          </div>

          {genTable ? (
            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{genTable.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {genTable.rows.length} row{genTable.rows.length === 1 ? "" : "s"} • {genTable.columns.length} col
                    {genTable.columns.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                    onClick={() => {
                      if (!genCsv) return;
                      navigator.clipboard?.writeText(genCsv).catch(() => {});
                    }}
                    disabled={!genCsv}
                    title={!genCsv ? "No CSV available" : "Copy CSV"}
                  >
                    Copy CSV
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                    onClick={() => {
                      if (!genCsv) return;
                      const safe = slugifyFilename(genTable.title || "spreadsheet");
                      downloadTextFile(`${safe || "spreadsheet"}.csv`, genCsv, "text/csv");
                    }}
                    disabled={!genCsv}
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                    onClick={async () => {
                      if (!genTable) return;
                      try {
                        setGenExportingXlsx(true);
                        setGenError("");
                        await downloadXlsx(genTable.title, genTable.columns, genTable.rows);
                      } catch (e: any) {
                        setGenError(e?.message ?? "Failed to export XLSX");
                      } finally {
                        setGenExportingXlsx(false);
                      }
                    }}
                    disabled={!genTable || genExportingXlsx}
                  >
                    {genExportingXlsx ? "Exporting XLSX..." : "Download XLSX"}
                  </button>
                </div>
              </div>

              {genTable.notes ? (
                <div className="rounded-xl border bg-background/40 p-3 text-sm">{genTable.notes}</div>
              ) : null}

              {genError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{genError}</div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full border-separate border-spacing-y-1 text-left text-sm">
                  <thead className="border-b bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20">
                    <tr>
                      {genTable.columns.map((c, idx) => (
                        <th key={idx} className="px-3 py-2 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {genTable.rows.slice(0, 200).map((r, idx) => (
                      <tr key={idx} className="border-b last:border-b-0">
                        {genTable.columns.map((_, j) => (
                          <td key={j} className="px-3 py-2 align-top text-muted-foreground">
                            {String(r?.[j] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {genTable.rows.length > 200 ? (
                      <tr>
                        <td colSpan={genTable.columns.length} className="px-3 py-3 text-xs text-muted-foreground">
                          Showing first 200 rows. Download CSV to view all.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-muted-foreground">
                Next: connect Google Sheets, then “Apply” will write to the sheet + keep this audit trail.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === "csv" ? (
        <>
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <div className="text-base font-semibold">Propose edits to an existing CSV</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Audit-friendly: generate a proposal first. No external sheet writes yet.
              </div>
            </div>

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
                This is proposal-only. No updates are applied to an external sheet yet.
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
                {canApply ? "Owner/Admin can apply proposals." : "Apply requires owner/admin."}
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
                    {proposalId ? (
                      <>
                        {" "}
                        • Proposal: <span className="font-mono">{proposalId}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onApply}
                  disabled={!canApplyNow}
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
                  title={!canApply ? "Owner/admin only" : proposal?.updates?.length ? "" : "No changes proposed"}
                >
                  {applying ? "Applying..." : "Apply (audit only)"}
                </button>
              </div>

              {applyMsg ? <div className="rounded-xl border bg-muted/40 p-3 text-sm">{applyMsg}</div> : null}

              {proposal.notes ? (
                <div className="rounded-xl border bg-background/40 p-3 text-sm">{proposal.notes}</div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full border-separate border-spacing-y-1 text-left text-sm">
                  <thead className="border-b bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20">
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

              <div className="text-xs text-muted-foreground">
                Next: connect Google Sheets, then “Apply” will write to the sheet + keep this audit trail.
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {mode === "ai" ? (
        <div className="space-y-6">
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <div className="text-base font-semibold">Generate from AI</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Prompt-based starter spreadsheet builder. This now uses the real AI route.
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium">Max rows</div>
                <input
                  value={String(aiMaxRows)}
                  onChange={(e) => setAiMaxRows(Number(e.target.value))}
                  type="number"
                  min={1}
                  max={200}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                />
                <div className="mt-2 text-xs text-muted-foreground">Starter draft capped at 200 rows.</div>
              </div>

              <div>
                <div className="text-sm font-medium">Optional columns</div>
                <input
                  value={aiColumns}
                  onChange={(e) => setAiColumns(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  placeholder="client, stage, owner, status, due_date"
                />
                <div className="mt-2 text-xs text-muted-foreground">Leave blank for smart defaults.</div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">What should the spreadsheet be for?</div>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
                placeholder='Example: "Create a sales pipeline tracker for 10 prospects with owner, stage, value, and follow-up date."'
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onGenerateAi}
                disabled={!canGenerateAi}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {aiGenerating ? "Generating..." : "Generate spreadsheet"}
              </button>

              <div className="text-xs text-muted-foreground">
                {aiProposalId ? (
                  <>
                    Proposal: <span className="font-mono">{aiProposalId}</span>
                  </>
                ) : (
                  "Creates an auditable AI-generated proposal record."
                )}
              </div>
            </div>

            {aiError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{aiError}</div>
            ) : null}
          </div>

          {aiTable ? (
            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{aiTable.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {aiTable.rows.length} row{aiTable.rows.length === 1 ? "" : "s"} • {aiTable.columns.length} col
                    {aiTable.columns.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                    onClick={() => {
                      if (!aiCsv) return;
                      navigator.clipboard?.writeText(aiCsv).catch(() => {});
                    }}
                    disabled={!aiCsv}
                  >
                    Copy CSV
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                    onClick={() => {
                      if (!aiCsv) return;
                      const safe = slugifyFilename(aiTable.title || "spreadsheet");
                      downloadTextFile(`${safe || "spreadsheet"}.csv`, aiCsv, "text/csv");
                    }}
                    disabled={!aiCsv}
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                    onClick={async () => {
                      if (!aiTable) return;
                      try {
                        setAiExportingXlsx(true);
                        setAiError("");
                        await downloadXlsx(aiTable.title, aiTable.columns, aiTable.rows);
                      } catch (e: any) {
                        setAiError(e?.message ?? "Failed to export XLSX");
                      } finally {
                        setAiExportingXlsx(false);
                      }
                    }}
                    disabled={!aiTable || aiExportingXlsx}
                  >
                    {aiExportingXlsx ? "Exporting XLSX..." : "Download XLSX"}
                  </button>
                </div>
              </div>

              {aiTable.notes ? (
                <div className="rounded-xl border bg-background/40 p-3 text-sm">{aiTable.notes}</div>
              ) : null}

              {aiError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{aiError}</div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full border-separate border-spacing-y-1 text-left text-sm">
                  <thead className="border-b bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20">
                    <tr>
                      {aiTable.columns.map((c, idx) => (
                        <th key={idx} className="px-3 py-2 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {aiTable.rows.map((r, idx) => (
                      <tr key={idx} className="border-b last:border-b-0">
                        {aiTable.columns.map((_, j) => (
                          <td key={j} className="px-3 py-2 align-top text-muted-foreground">
                            {String(r?.[j] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}