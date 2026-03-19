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

type CampaignSummary = {
  id: string;
  title: string;
  description?: string;
  status: string;
  source_query?: string;
  created_at?: string;
  updated_at?: string;
  lead_count: number;
  sent_count: number;
  replied_count: number;
  new_count: number;
};

type OutreachLead = {
  id: string;
  company_name: string;
  contact_name?: string;
  contact_title?: string;
  email?: string;
  website?: string;
  location?: string;
  niche?: string;
  source_url?: string;
  confidence?: number | null;
  status: string;
  last_contacted_at?: string;
  replied_at?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
};

type CampaignDetail = {
  id: string;
  title: string;
  description?: string;
  status: string;
  source_query?: string;
  created_at?: string;
  updated_at?: string;
};

type GenColumn = {
  key: string;
  label?: string;
  type?: "text" | "number" | "date" | "currency" | "boolean" | string;
};

type SpreadsheetMode = "docs" | "csv" | "ai";

const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "drafted", label: "Drafted" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "bounced", label: "Bounced" },
  { value: "do_not_contact", label: "Do Not Contact" },
] as const;

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

function normalizeTableRows(input: any): string[][] {
  if (!Array.isArray(input)) return [];
  return input.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []));
}

function extractGeneratedTable(j: any, fallbackTitle: string): GeneratedTable | null {
  const tableCols = Array.isArray(j?.table?.columns)
    ? j.table.columns.map((c: any) => String(c ?? "").trim()).filter(Boolean)
    : [];

  const tableRows = normalizeTableRows(j?.table?.rows);

  if (tableCols.length > 0) {
    return {
      title:
        typeof j?.table?.title === "string" && j.table.title.trim()
          ? j.table.title
          : typeof j?.title === "string" && j.title.trim()
            ? j.title
            : fallbackTitle,
      columns: tableCols,
      rows: tableRows,
      notes:
        typeof j?.table?.notes === "string"
          ? j.table.notes
          : typeof j?.notes === "string"
            ? j.notes
            : "",
    };
  }

  const colsObj = Array.isArray(j?.columns) ? (j.columns as GenColumn[]) : [];
  const rowsObj = Array.isArray(j?.rows) ? (j.rows as Array<Record<string, any>>) : [];

  if (colsObj.length === 0) return null;

  const displayCols = colsObj.map((c) => String(c?.label || c?.key || "").trim()).filter(Boolean);
  const rowArrays = toRowArrays(colsObj, rowsObj);

  return {
    title: typeof j?.title === "string" && j.title.trim() ? j.title : fallbackTitle,
    columns: displayCols.length ? displayCols : colsObj.map((c) => String(c.key)),
    rows: rowArrays,
    notes: typeof j?.notes === "string" ? j.notes : "",
  };
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatConfidence(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function leadRowStyle(status: string) {
  const s = String(status || "").toLowerCase();
  return {
    sentStyle: s === "sent",
    repliedStyle: s === "replied",
    rejectedStyle: s === "rejected" || s === "do_not_contact" || s === "bounced",
  };
}

function CampaignRowPreview({
  campaign,
  active,
  onOpen,
}: {
  campaign: CampaignSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const total = Number(campaign.lead_count || 0);
  const sent = Number(campaign.sent_count || 0);
  const replied = Number(campaign.replied_count || 0);
  const fresh = Number(campaign.new_count || 0);

  const rows = [
    ["Company", "Contact", "Email", "Status", "Last Contacted"],
    ["Acme Creative", "Founder", "founder@acme.com", fresh > 0 ? "new" : "sent", fresh > 0 ? "" : "sent"],
    ["North Peak", "Owner", "owner@northpeak.com", sent > 0 ? "sent" : "new", sent > 0 ? "sent" : ""],
    ["Blue Studio", "Director", "hello@bluestudio.com", replied > 0 ? "replied" : "new", replied > 0 ? "replied" : ""],
  ];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "w-full rounded-3xl border bg-card p-5 text-left shadow-sm space-y-4 transition hover:-translate-y-[1px]",
        active && "border-foreground/30 ring-2 ring-foreground/10"
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-base font-semibold">{campaign.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {campaign.description || campaign.source_query || "Lead campaign"}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Created: {formatDate(campaign.created_at)} • Updated: {formatDate(campaign.updated_at)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border bg-background/60 px-3 py-1">Leads: {total}</span>
          <span className="rounded-full border bg-background/60 px-3 py-1">New: {fresh}</span>
          <span className="rounded-full border bg-background/60 px-3 py-1">Sent: {sent}</span>
          <span className="rounded-full border bg-background/60 px-3 py-1">Replied: {replied}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full border-separate border-spacing-y-1 text-left text-sm">
          <thead className="border-b bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20">
            <tr>
              {rows[0].map((c, idx) => (
                <th key={idx} className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((r, idx) => {
              const status = String(r[3] || "").toLowerCase();
              const sentStyle = status === "sent";
              const repliedStyle = status === "replied";

              return (
                <tr
                  key={idx}
                  className={cx(
                    "border-b last:border-b-0",
                    sentStyle && "opacity-60",
                    repliedStyle && "bg-emerald-50/50"
                  )}
                >
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className={cx(
                        "px-3 py-2 align-top text-muted-foreground",
                        sentStyle && "line-through",
                        repliedStyle && j === 3 && "font-medium text-emerald-700"
                      )}
                    >
                      {String(cell ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-muted-foreground">
        Campaign spreadsheets auto-mute sent leads and highlight replied leads.
      </div>
    </button>
  );
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

  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignLimit, setCampaignLimit] = useState<number>(25);
  const [campaignTitle, setCampaignTitle] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [findingLeads, setFindingLeads] = useState(false);
  const [campaignError, setCampaignError] = useState("");
  const [campaignMsg, setCampaignMsg] = useState("");

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignDetail, setCampaignDetail] = useState<CampaignDetail | null>(null);
  const [campaignLeads, setCampaignLeads] = useState<OutreachLead[]>([]);
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false);
  const [campaignDetailError, setCampaignDetailError] = useState("");
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);

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

  const [csv, setCsv] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string>("");

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

  const canFindCampaignLeads = useMemo(() => {
    return campaignQuery.trim().length > 0 && !findingLeads;
  }, [campaignQuery, findingLeads]);

  async function loadBase() {
    const j = await fetchJson<any>("/api/spreadsheets", { credentials: "include", cache: "no-store" });

    setPlan(typeof j?.plan === "string" ? j.plan : undefined);
    setUpsell(j?.upsell ?? null);
    setCanApply(Boolean(j?.can_apply));
    setCampaigns(Array.isArray(j?.campaigns) ? j.campaigns : []);

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

        setBots(parsed);

        setBotId((prev) => {
          if (prev) return prev;
          const agency = parsed.find((x) => !x.owner_user_id) ?? parsed[0];
          return agency?.id ?? "";
        });
      } catch {
        setBots([]);
      }
    }
  }

  async function loadCampaignDetail(campaignId: string) {
    if (!campaignId) return;

    setCampaignDetailLoading(true);
    setCampaignDetailError("");

    try {
      const j = await fetchJson<any>(`/api/outreach/campaigns/${encodeURIComponent(campaignId)}`, {
        credentials: "include",
        cache: "no-store",
      });

      setCampaignDetail(j?.campaign ?? null);
      setCampaignLeads(Array.isArray(j?.leads) ? j.leads : []);
      setSelectedCampaignId(campaignId);
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setCampaignDetailError(e?.message ?? "Failed to load campaign");
      setCampaignDetail(null);
      setCampaignLeads([]);
    } finally {
      setCampaignDetailLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGated(false);
      setError("");

      try {
        await loadBase();
        if (cancelled) return;
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

  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      void loadCampaignDetail(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

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
      } catch {}
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

  async function onFindLeads() {
    if (!canFindCampaignLeads) return;

    setFindingLeads(true);
    setCampaignError("");
    setCampaignMsg("");

    try {
      const j = await fetchJson<any>("/api/outreach/find-leads", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: campaignQuery,
          limit: Number.isFinite(campaignLimit) ? Math.max(1, Math.min(100, campaignLimit)) : 25,
          title: campaignTitle || undefined,
          description: campaignDescription || undefined,
        }),
      });

      setCampaignMsg(`Created campaign "${String(j?.campaign?.title || "Campaign")}" with ${Array.isArray(j?.leads) ? j.leads.length : 0} leads.`);
      setCampaignQuery("");
      setCampaignTitle("");
      setCampaignDescription("");

      await loadBase();

      const nextCampaignId = typeof j?.campaign_id === "string" ? j.campaign_id : "";
      if (nextCampaignId) {
        await loadCampaignDetail(nextCampaignId);
      }
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setCampaignError(e?.message ?? "Failed to find leads");
    } finally {
      setFindingLeads(false);
    }
  }

  async function onUpdateLeadStatus(leadId: string, status: string) {
    if (!selectedCampaignId || !leadId) return;

    setUpdatingLeadId(leadId);
    setCampaignDetailError("");
    setCampaignError("");

    try {
      await fetchJson<any>(`/api/outreach/campaigns/${encodeURIComponent(selectedCampaignId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          status,
        }),
      });

      setCampaignLeads((cur) =>
        cur.map((lead) => {
          if (lead.id !== leadId) return lead;
          const nowIso = new Date().toISOString();
          return {
            ...lead,
            status,
            last_contacted_at: status === "sent" ? nowIso : lead.last_contacted_at,
            replied_at: status === "replied" ? nowIso : lead.replied_at,
            updated_at: nowIso,
          };
        })
      );

      await loadBase();
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      setCampaignDetailError(e?.message ?? "Failed to update lead");
    } finally {
      setUpdatingLeadId(null);
    }
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

      const table = extractGeneratedTable(j, "Generated Spreadsheet");

      if (!table || table.columns.length === 0) {
        setGenFallback("I don’t have that information in the docs yet.");
        return;
      }

      setGenTable(table);
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

      const table = extractGeneratedTable(j, "AI Spreadsheet Draft");

      if (!table || table.columns.length === 0) {
        setAiError("Failed to generate AI spreadsheet");
        return;
      }

      setAiTable(table);
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
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Spreadsheets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One menu for docs generation, CSV edits, AI generation, and campaign tracking. Plan:{" "}
            <span className="font-mono">{plan ?? "unknown"}</span>
          </p>
        </div>

        <ModeActionMenu mode={mode} setMode={setMode} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-base font-semibold">Lead finder → campaign spreadsheet</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Find leads, create a campaign, and automatically turn it into a live outreach spreadsheet.
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Sent leads will be crossed out automatically once outreach is completed.
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">Lead search query</div>
              <textarea
                value={campaignQuery}
                onChange={(e) => setCampaignQuery(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
                placeholder='Example: "Find 25 small marketing agencies in Texas and try to get founder or owner emails."'
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium">Campaign title</div>
                <input
                  value={campaignTitle}
                  onChange={(e) => setCampaignTitle(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  placeholder="Texas agency outreach"
                />
              </div>

              <div>
                <div className="text-sm font-medium">Lead count</div>
                <input
                  value={String(campaignLimit)}
                  onChange={(e) => setCampaignLimit(Number(e.target.value))}
                  type="number"
                  min={1}
                  max={100}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">Optional campaign notes</div>
              <input
                value={campaignDescription}
                onChange={(e) => setCampaignDescription(e.target.value)}
                className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                placeholder="For Corp pitch outreach"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  void onFindLeads();
                }}
                disabled={!canFindCampaignLeads}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {findingLeads ? "Finding leads..." : "Find leads + create campaign"}
              </button>

              <div className="text-xs text-muted-foreground">
                Creates a spreadsheet-style campaign tracker automatically.
              </div>
            </div>

            {campaignError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{campaignError}</div>
            ) : null}

            {campaignMsg ? (
              <div className="rounded-xl border bg-muted/40 p-3 text-sm">{campaignMsg}</div>
            ) : null}
          </div>

          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-base font-semibold">Campaign spreadsheets</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Click a campaign to open the editable spreadsheet-style lead tracker.
                </div>
              </div>
            </div>

            {campaigns.length === 0 ? (
              <div className="rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
                No campaigns yet. Use the lead finder above to create your first outreach campaign.
              </div>
            ) : (
              <div className="space-y-4">
                {campaigns.map((campaign) => (
                  <CampaignRowPreview
                    key={campaign.id}
                    campaign={campaign}
                    active={selectedCampaignId === campaign.id}
                    onOpen={() => {
                      void loadCampaignDetail(campaign.id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-base font-semibold">
                {campaignDetail?.title || "Campaign detail"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {campaignDetail?.description || campaignDetail?.source_query || "Open a campaign to manage lead statuses."}
              </div>
            </div>

            {campaignDetail ? (
              <div className="text-xs text-muted-foreground">
                Updated: {formatDate(campaignDetail.updated_at)}
              </div>
            ) : null}
          </div>

          {campaignDetailError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {campaignDetailError}
            </div>
          ) : null}

          {campaignDetailLoading ? (
            <div className="rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
              Loading campaign...
            </div>
          ) : !campaignDetail ? (
            <div className="rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
              Select a campaign on the left to open its outreach spreadsheet.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border bg-background/60 px-3 py-1">
                  Leads: {campaignLeads.length}
                </span>
                <span className="rounded-full border bg-background/60 px-3 py-1">
                  New: {campaignLeads.filter((l) => l.status === "new").length}
                </span>
                <span className="rounded-full border bg-background/60 px-3 py-1">
                  Sent: {campaignLeads.filter((l) => l.status === "sent").length}
                </span>
                <span className="rounded-full border bg-background/60 px-3 py-1">
                  Replied: {campaignLeads.filter((l) => l.status === "replied").length}
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[1100px] border-separate border-spacing-y-1 text-left text-sm">
                  <thead className="border-b bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20">
                    <tr>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Contact</th>
                      <th className="px-3 py-2 font-medium">Title</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Website</th>
                      <th className="px-3 py-2 font-medium">Location</th>
                      <th className="px-3 py-2 font-medium">Confidence</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Last Contacted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignLeads.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-4 text-muted-foreground">
                          No leads found in this campaign yet.
                        </td>
                      </tr>
                    ) : (
                      campaignLeads.map((lead) => {
                        const styles = leadRowStyle(lead.status);
                        return (
                          <tr
                            key={lead.id}
                            className={cx(
                              "border-b last:border-b-0",
                              styles.sentStyle && "opacity-60",
                              styles.repliedStyle && "bg-emerald-50/50",
                              styles.rejectedStyle && "opacity-45"
                            )}
                          >
                            <td className={cx("px-3 py-2 align-top", styles.sentStyle && "line-through")}>
                              {lead.company_name || "—"}
                            </td>
                            <td className={cx("px-3 py-2 align-top text-muted-foreground", styles.sentStyle && "line-through")}>
                              {lead.contact_name || "—"}
                            </td>
                            <td className={cx("px-3 py-2 align-top text-muted-foreground", styles.sentStyle && "line-through")}>
                              {lead.contact_title || "—"}
                            </td>
                            <td className={cx("px-3 py-2 align-top text-muted-foreground", styles.sentStyle && "line-through")}>
                              {lead.email || "—"}
                            </td>
                            <td className="px-3 py-2 align-top text-muted-foreground">
                              {lead.website ? (
                                <a
                                  href={lead.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline underline-offset-2"
                                >
                                  {lead.website}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-muted-foreground">{lead.location || "—"}</td>
                            <td className="px-3 py-2 align-top text-muted-foreground">
                              {formatConfidence(lead.confidence)}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <select
                                value={lead.status}
                                onChange={(e) => {
                                  void onUpdateLeadStatus(lead.id, e.target.value);
                                }}
                                disabled={updatingLeadId === lead.id}
                                className={cx(
                                  "h-10 min-w-[140px] rounded-xl border bg-background/70 px-3 text-sm",
                                  styles.repliedStyle && "border-emerald-300 text-emerald-700"
                                )}
                              >
                                {LEAD_STATUSES.map((s) => (
                                  <option key={s.value} value={s.value}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 align-top text-muted-foreground">
                              {lead.status === "replied"
                                ? formatDate(lead.replied_at || lead.last_contacted_at)
                                : formatDate(lead.last_contacted_at)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-muted-foreground">
                Mark a lead as <span className="font-medium">Sent</span> and the row will mute / strike through automatically.
                Mark it as <span className="font-medium">Replied</span> to highlight the row.
              </div>
            </>
          )}
        </div>
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