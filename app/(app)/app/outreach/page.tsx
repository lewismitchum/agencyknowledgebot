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
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
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
  if (v == null) return "—";
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}