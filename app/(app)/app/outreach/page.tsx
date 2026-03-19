"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

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

  const canFindCampaignLeads = useMemo(() => {
    return campaignQuery.trim().length > 0 && !findingLeads;
  }, [campaignQuery, findingLeads]);

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
      if (isFetchJsonError(e) && (e.status === 401 || e?.info?.status === 401)) {
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
            Find leads, create campaigns, track outreach, and connect the workflow to spreadsheets and email. Plan:{" "}
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
                Next step after this: wire draft/send controls so successful sends auto-mark leads as sent.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}