"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type Bot = {
  id: string;
  name: string;
  owner_user_id?: string | null;
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

type DraftPreview = {
  leadId: string;
  subject: string;
  body: string;
};

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
  return !!e && typeof e === "object" && ("status" in e || "code" in e || "info" in e);
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

function clampText(value: string, max: number) {
  const s = String(value || "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function CampaignCard({
  campaign,
  active,
  onOpen,
}: {
  campaign: CampaignSummary;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "w-full rounded-3xl border bg-card p-5 text-left shadow-sm transition hover:-translate-y-[1px]",
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
          <span className="rounded-full border bg-background/60 px-3 py-1">Leads: {campaign.lead_count || 0}</span>
          <span className="rounded-full border bg-background/60 px-3 py-1">New: {campaign.new_count || 0}</span>
          <span className="rounded-full border bg-background/60 px-3 py-1">Sent: {campaign.sent_count || 0}</span>
          <span className="rounded-full border bg-background/60 px-3 py-1">
            Replied: {campaign.replied_count || 0}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function OutreachPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState("");

  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignLimit, setCampaignLimit] = useState<number>(10);
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

  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [draftPrompt, setDraftPrompt] = useState(
    "Write a short cold email introducing Louis.Ai, focusing on agency knowledge, docs-backed answers, schedule extraction, spreadsheet AI, and email automation."
  );
  const [draftTone, setDraftTone] = useState("concise");
  const [draftSubjectHint, setDraftSubjectHint] = useState("Quick idea for your team");
  const [drafts, setDrafts] = useState<DraftPreview[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [automationRunning, setAutomationRunning] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");
  const [draftError, setDraftError] = useState("");

  const canFindCampaignLeads = useMemo(() => {
    return campaignQuery.trim().length > 0 && !findingLeads;
  }, [campaignQuery, findingLeads]);

  const selectedLeads = useMemo(() => {
    return campaignLeads.filter((lead) => selectedLeadIds.includes(lead.id));
  }, [campaignLeads, selectedLeadIds]);

  const approvedLeads = useMemo(() => {
    return campaignLeads.filter((lead) => lead.status === "approved");
  }, [campaignLeads]);

  const draftedLeads = useMemo(() => {
    return campaignLeads.filter((lead) => lead.status === "drafted");
  }, [campaignLeads]);

  const sendableLeads = useMemo(() => {
    return campaignLeads.filter((lead) => lead.status === "drafted" && lead.email);
  }, [campaignLeads]);

  async function loadBase() {
    const j = await fetchJson<any>("/api/spreadsheets", {
      credentials: "include",
      cache: "no-store",
    });

    setPlan(typeof j?.plan === "string" ? j.plan : undefined);
    setUpsell(j?.upsell ?? null);
    setCampaigns(Array.isArray(j?.campaigns) ? j.campaigns : []);

    const allowed = Boolean(j?.ok) && !j?.upsell?.code;
    setGated(!allowed);

    if (allowed) {
      try {
        const b = await fetchJson<any>("/api/bots", {
          credentials: "include",
          cache: "no-store",
        });

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
      setSelectedLeadIds([]);
      setDrafts([]);
      setDraftMsg("");
      setDraftError("");
    } catch (e: any) {
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
        window.location.href = "/login";
        return;
      }
      setCampaignDetailError(e?.message ?? "Failed to load campaign");
      setCampaignDetail(null);
      setCampaignLeads([]);
      setSelectedLeadIds([]);
      setDrafts([]);
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

        if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load outreach");
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

  function toggleLeadSelection(leadId: string) {
    setSelectedLeadIds((cur) =>
      cur.includes(leadId) ? cur.filter((id) => id !== leadId) : [...cur, leadId]
    );
  }

  function toggleAllVisibleLeads() {
    if (campaignLeads.length === 0) return;
    if (selectedLeadIds.length === campaignLeads.length) {
      setSelectedLeadIds([]);
      return;
    }
    setSelectedLeadIds(campaignLeads.map((lead) => lead.id));
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
          limit: Number.isFinite(campaignLimit) ? Math.max(1, Math.min(100, campaignLimit)) : 10,
          title: campaignTitle || undefined,
          description: campaignDescription || undefined,
        }),
      });

      setCampaignMsg(
        `Created campaign "${String(j?.campaign?.title || "Campaign")}" with ${
          Array.isArray(j?.leads) ? j.leads.length : 0
        } leads.`
      );

      setCampaignQuery("");
      setCampaignTitle("");
      setCampaignDescription("");

      await loadBase();

      const nextCampaignId = typeof j?.campaign_id === "string" ? j.campaign_id : "";
      if (nextCampaignId) {
        await loadCampaignDetail(nextCampaignId);
      }
    } catch (e: any) {
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
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
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
        window.location.href = "/login";
        return;
      }
      setCampaignDetailError(e?.message ?? "Failed to update lead");
    } finally {
      setUpdatingLeadId(null);
    }
  }

  async function bulkUpdateStatuses(leads: OutreachLead[], status: string) {
    if (!selectedCampaignId || leads.length === 0) return;

    for (const lead of leads) {
      await fetchJson<any>(`/api/outreach/campaigns/${encodeURIComponent(selectedCampaignId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          status,
        }),
      });
    }

    const nowIso = new Date().toISOString();

    setCampaignLeads((cur) =>
      cur.map((lead) => {
        const hit = leads.find((x) => x.id === lead.id);
        if (!hit) return lead;
        return {
          ...lead,
          status,
          updated_at: nowIso,
          last_contacted_at: status === "sent" ? nowIso : lead.last_contacted_at,
          replied_at: status === "replied" ? nowIso : lead.replied_at,
        };
      })
    );

    await loadBase();
  }

  function buildDraftForLead(lead: OutreachLead) {
    const firstName = clampText(
      lead.contact_name?.split(" ")[0] || lead.contact_name || lead.company_name || "there",
      40
    );
    const company = clampText(lead.company_name || "your team", 120);
    const niche = clampText(lead.niche || "your agency", 120);
    const title = clampText(lead.contact_title || "team", 120);
    const toneLine =
      draftTone === "direct"
        ? "I’ll keep this direct."
        : draftTone === "friendly"
          ? "Keeping this friendly and simple."
          : draftTone === "formal"
            ? "Keeping this professional and concise."
            : "Keeping this concise.";

    const subject = clampText(
      draftSubjectHint || `Quick idea for ${company}`,
      140
    );

    const promptLine = clampText(draftPrompt, 600);

    const body = [
      `Hi ${firstName},`,
      ``,
      `${toneLine}`,
      ``,
      `I came across ${company}${lead.location ? ` in ${lead.location}` : ""} and thought this might be relevant for your ${niche}${title ? ` ${title}` : ""}.`,
      ``,
      `Louis.Ai helps agencies keep internal knowledge organized, answer from docs first, extract schedule items from files, and run spreadsheet and email workflows in one place.`,
      ``,
      `Why I’m reaching out: ${promptLine}`,
      ``,
      `If it’s useful, I can send over a quick walkthrough tailored to ${company}.`,
      ``,
      `Best,`,
      `Lewis`,
    ].join("\n");

    return {
      leadId: lead.id,
      subject,
      body,
    };
  }

  async function onDraftSelected() {
    if (!selectedCampaignId || selectedLeads.length === 0) {
      setDraftError("Select at least one lead first.");
      return;
    }

    setDrafting(true);
    setDraftError("");
    setDraftMsg("");

    try {
      const nextDrafts = selectedLeads.map(buildDraftForLead);
      setDrafts(nextDrafts);
      await bulkUpdateStatuses(selectedLeads, "drafted");
      setDraftMsg(`Created ${nextDrafts.length} draft preview${nextDrafts.length === 1 ? "" : "s"} and marked them drafted.`);
    } catch (e: any) {
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
        window.location.href = "/login";
        return;
      }
      setDraftError(e?.message ?? "Failed to draft selected leads");
    } finally {
      setDrafting(false);
    }
  }

  async function onDraftApproved() {
    if (!selectedCampaignId || approvedLeads.length === 0) {
      setDraftError("No approved leads available to draft.");
      return;
    }

    setDrafting(true);
    setDraftError("");
    setDraftMsg("");

    try {
      const nextDrafts = approvedLeads.map(buildDraftForLead);
      setDrafts(nextDrafts);
      setSelectedLeadIds(approvedLeads.map((lead) => lead.id));
      await bulkUpdateStatuses(approvedLeads, "drafted");
      setDraftMsg(`Created ${nextDrafts.length} approved-lead draft preview${nextDrafts.length === 1 ? "" : "s"}.`);
    } catch (e: any) {
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
        window.location.href = "/login";
        return;
      }
      setDraftError(e?.message ?? "Failed to draft approved leads");
    } finally {
      setDrafting(false);
    }
  }

  async function onAutomateApproved() {
    if (!selectedCampaignId || approvedLeads.length === 0) {
      setDraftError("No approved leads available to automate.");
      return;
    }

    setAutomationRunning(true);
    setDraftError("");
    setDraftMsg("");

    try {
      const nextDrafts = approvedLeads.map(buildDraftForLead);
      setDrafts(nextDrafts);
      setSelectedLeadIds(approvedLeads.map((lead) => lead.id));
      await bulkUpdateStatuses(approvedLeads, "drafted");
      setDraftMsg(
        `Automation queued ${approvedLeads.length} approved lead${approvedLeads.length === 1 ? "" : "s"} into drafted status. Next step is wiring real send delivery.`
      );
    } catch (e: any) {
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
        window.location.href = "/login";
        return;
      }
      setDraftError(e?.message ?? "Failed to automate approved leads");
    } finally {
      setAutomationRunning(false);
    }
  }

  async function onMarkDraftedSent() {
    if (!selectedCampaignId || sendableLeads.length === 0) {
      setDraftError("No drafted leads with email addresses are ready to mark sent.");
      return;
    }

    setAutomationRunning(true);
    setDraftError("");
    setDraftMsg("");

    try {
      await bulkUpdateStatuses(sendableLeads, "sent");
      setDraftMsg(
        `Marked ${sendableLeads.length} drafted lead${sendableLeads.length === 1 ? "" : "s"} as sent.`
      );
    } catch (e: any) {
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
        window.location.href = "/login";
        return;
      }
      setDraftError(e?.message ?? "Failed to mark drafted leads sent");
    } finally {
      setAutomationRunning(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Outreach is available on paid plans"
          message={upsell?.message || "Upgrade to unlock outreach lead generation and campaign tracking."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Outreach</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Outreach</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find leads, draft campaign emails, and automate status flow into email and spreadsheets. Plan:{" "}
            <span className="font-mono">{plan ?? "unknown"}</span>
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <div className="text-base font-semibold">Lead generation prompt</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Enter exactly what kind of leads you want Louis to find.
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">Prompt</div>
              <textarea
                value={campaignQuery}
                onChange={(e) => setCampaignQuery(e.target.value)}
                rows={5}
                className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
                placeholder='Example: "Find 10 small marketing agencies in Texas with founder or owner emails"'
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
              <div className="text-sm font-medium">Campaign notes</div>
              <input
                value={campaignDescription}
                onChange={(e) => setCampaignDescription(e.target.value)}
                className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                placeholder="Corp plan pitch / Austin market / agency niche"
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
                {findingLeads ? "Finding leads..." : "Generate leads"}
              </button>

              <div className="text-xs text-muted-foreground">Creates a campaign and saves leads automatically.</div>
            </div>

            {campaignError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{campaignError}</div>
            ) : null}

            {campaignMsg ? <div className="rounded-xl border bg-muted/40 p-3 text-sm">{campaignMsg}</div> : null}
          </div>

          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <div className="text-base font-semibold">Campaigns</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Open a campaign to review leads and update statuses.
              </div>
            </div>

            {campaigns.length === 0 ? (
              <div className="rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
                No campaigns yet. Generate your first lead list above.
              </div>
            ) : (
              <div className="space-y-3">
                {campaigns.map((campaign) => (
                  <CampaignCard
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

        <div className="space-y-6">
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-base font-semibold">{campaignDetail?.title || "Campaign detail"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {campaignDetail?.description || campaignDetail?.source_query || "Select a campaign to manage leads."}
                </div>
              </div>

              {campaignDetail ? (
                <div className="text-xs text-muted-foreground">Updated: {formatDate(campaignDetail.updated_at)}</div>
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
                Select a campaign on the left to open its leads.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border bg-background/60 px-3 py-1">Leads: {campaignLeads.length}</span>
                  <span className="rounded-full border bg-background/60 px-3 py-1">
                    New: {campaignLeads.filter((l) => l.status === "new").length}
                  </span>
                  <span className="rounded-full border bg-background/60 px-3 py-1">
                    Approved: {approvedLeads.length}
                  </span>
                  <span className="rounded-full border bg-background/60 px-3 py-1">
                    Drafted: {draftedLeads.length}
                  </span>
                  <span className="rounded-full border bg-background/60 px-3 py-1">
                    Sent: {campaignLeads.filter((l) => l.status === "sent").length}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[1180px] border-separate border-spacing-y-1 text-left text-sm">
                    <thead className="border-b bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20">
                      <tr>
                        <th className="px-3 py-2 font-medium">
                          <input
                            type="checkbox"
                            checked={campaignLeads.length > 0 && selectedLeadIds.length === campaignLeads.length}
                            onChange={toggleAllVisibleLeads}
                          />
                        </th>
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
                          <td colSpan={10} className="px-3 py-4 text-muted-foreground">
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
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="checkbox"
                                  checked={selectedLeadIds.includes(lead.id)}
                                  onChange={() => toggleLeadSelection(lead.id)}
                                />
                              </td>
                              <td className={cx("px-3 py-2 align-top", styles.sentStyle && "line-through")}>
                                {lead.company_name || "—"}
                              </td>
                              <td
                                className={cx(
                                  "px-3 py-2 align-top text-muted-foreground",
                                  styles.sentStyle && "line-through"
                                )}
                              >
                                {lead.contact_name || "—"}
                              </td>
                              <td
                                className={cx(
                                  "px-3 py-2 align-top text-muted-foreground",
                                  styles.sentStyle && "line-through"
                                )}
                              >
                                {lead.contact_title || "—"}
                              </td>
                              <td
                                className={cx(
                                  "px-3 py-2 align-top text-muted-foreground",
                                  styles.sentStyle && "line-through"
                                )}
                              >
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
                  Select leads here, then use the drafting and automation panels below.
                </div>
              </>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
              <div>
                <div className="text-base font-semibold">Email drafting</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Draft for selected leads, or bulk draft approved leads.
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
                </div>

                <div>
                  <div className="text-sm font-medium">Tone</div>
                  <select
                    value={draftTone}
                    onChange={(e) => setDraftTone(e.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  >
                    <option value="concise">Concise</option>
                    <option value="friendly">Friendly</option>
                    <option value="formal">Formal</option>
                    <option value="direct">Direct</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Subject hint</div>
                <input
                  value={draftSubjectHint}
                  onChange={(e) => setDraftSubjectHint(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  placeholder="Quick idea for your agency"
                />
              </div>

              <div>
                <div className="text-sm font-medium">Draft instructions</div>
                <textarea
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
                  placeholder="What should Louis say in the email?"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void onDraftSelected();
                  }}
                  disabled={drafting || selectedLeads.length === 0}
                  className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
                >
                  {drafting ? "Drafting..." : `Draft selected (${selectedLeads.length})`}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void onDraftApproved();
                  }}
                  disabled={drafting || approvedLeads.length === 0}
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
                >
                  Draft approved ({approvedLeads.length})
                </button>
              </div>

              {draftError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {draftError}
                </div>
              ) : null}

              {draftMsg ? <div className="rounded-xl border bg-muted/40 p-3 text-sm">{draftMsg}</div> : null}

              {drafts.length === 0 ? (
                <div className="rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
                  No draft previews yet. Select leads and click a draft action.
                </div>
              ) : (
                <div className="space-y-3">
                  {drafts.map((draft) => {
                    const lead = campaignLeads.find((x) => x.id === draft.leadId);
                    return (
                      <div key={draft.leadId} className="rounded-2xl border bg-background/40 p-4">
                        <div className="text-sm font-medium">
                          {lead?.company_name || "Lead"} {lead?.email ? `• ${lead.email}` : ""}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">Subject</div>
                        <div className="mt-1 rounded-lg border bg-background px-3 py-2 text-sm">{draft.subject}</div>
                        <div className="mt-3 text-xs text-muted-foreground">Body</div>
                        <pre className="mt-1 whitespace-pre-wrap rounded-lg border bg-background px-3 py-3 text-sm">
                          {draft.body}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
              <div>
                <div className="text-base font-semibold">Campaign automation</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Bulk actions for outreach flow until real send delivery is wired.
                </div>
              </div>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void onAutomateApproved();
                  }}
                  disabled={automationRunning || approvedLeads.length === 0}
                  className="rounded-xl border px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-60"
                >
                  <div className="font-medium">Automate approved leads</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Bulk drafts all approved leads and moves them into drafted status.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void onMarkDraftedSent();
                  }}
                  disabled={automationRunning || sendableLeads.length === 0}
                  className="rounded-xl border px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-60"
                >
                  <div className="font-medium">Mark drafted as sent</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Use this after delivery to sync drafted leads into sent status.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (selectedLeads.length === 0) {
                      setDraftError("Select leads first.");
                      return;
                    }
                    try {
                      setAutomationRunning(true);
                      setDraftError("");
                      setDraftMsg("");
                      await bulkUpdateStatuses(selectedLeads, "approved");
                      setDraftMsg(`Approved ${selectedLeads.length} selected lead${selectedLeads.length === 1 ? "" : "s"}.`);
                    } catch (e: any) {
                      setDraftError(e?.message ?? "Failed to approve selected leads");
                    } finally {
                      setAutomationRunning(false);
                    }
                  }}
                  disabled={automationRunning || selectedLeads.length === 0}
                  className="rounded-xl border px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-60"
                >
                  <div className="font-medium">Approve selected</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Marks selected leads approved so they can move into draft automation.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (selectedLeads.length === 0) {
                      setDraftError("Select leads first.");
                      return;
                    }
                    try {
                      setAutomationRunning(true);
                      setDraftError("");
                      setDraftMsg("");
                      await bulkUpdateStatuses(selectedLeads, "do_not_contact");
                      setDraftMsg(
                        `Marked ${selectedLeads.length} selected lead${selectedLeads.length === 1 ? "" : "s"} as do not contact.`
                      );
                    } catch (e: any) {
                      setDraftError(e?.message ?? "Failed to update selected leads");
                    } finally {
                      setAutomationRunning(false);
                    }
                  }}
                  disabled={automationRunning || selectedLeads.length === 0}
                  className="rounded-xl border px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-60"
                >
                  <div className="font-medium">Do not contact selected</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Removes selected leads from active outreach flow.
                  </div>
                </button>
              </div>

              <div className="rounded-2xl border bg-background/40 p-4 text-sm text-muted-foreground">
                Real send delivery is the next backend step. This page now supports lead generation, draft previews,
                bulk draft automation, and status sync controls.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}