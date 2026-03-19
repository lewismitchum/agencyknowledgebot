// app/api/outreach/find-leads/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type LeadFinderBody = {
  query?: string;
  limit?: number;
  title?: string;
  description?: string;
};

type LeadRow = {
  company_name: string;
  contact_name?: string;
  contact_title?: string;
  email?: string;
  website?: string;
  location?: string;
  niche?: string;
  source_url?: string;
  confidence?: number;
  notes?: string;
};

function clampString(s: string, max: number) {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractJsonFromText(text: string): any | null {
  const t = String(text || "").trim();
  if (!t) return null;

  const raw = safeJsonParse(t);
  if (raw) return raw;

  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = safeJsonParse(fenced[1].trim());
    if (inner) return inner;
  }

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const inner = safeJsonParse(t.slice(start, end + 1));
    if (inner) return inner;
  }

  return null;
}

function makeId(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function normalizeLead(raw: any): LeadRow | null {
  const company_name = clampString(raw?.company_name ?? raw?.company ?? "", 200);
  if (!company_name) return null;

  const email = clampString(raw?.email ?? "", 240);
  const website = clampString(raw?.website ?? "", 300);
  const source_url = clampString(raw?.source_url ?? raw?.source ?? "", 500);

  let confidence = Number(raw?.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    company_name,
    contact_name: clampString(raw?.contact_name ?? "", 160),
    contact_title: clampString(raw?.contact_title ?? raw?.title ?? "", 160),
    email,
    website,
    location: clampString(raw?.location ?? "", 160),
    niche: clampString(raw?.niche ?? "", 120),
    source_url,
    confidence,
    notes: clampString(raw?.notes ?? "", 800),
  };
}

function titleFromQuery(query: string) {
  const q = clampString(query, 120);
  return q ? `Campaign - ${q}` : "Lead Campaign";
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const body = (await req.json().catch(() => null)) as LeadFinderBody | null;
    const query = clampString(body?.query ?? "", 2000);
    const limitRaw = Number(body?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;
    const title = clampString(body?.title ?? "", 160) || titleFromQuery(query);
    const description = clampString(body?.description ?? "", 500);

    if (!query) {
      return Response.json({ ok: false, error: "MISSING_QUERY" }, { status: 400 });
    }

    const prompt = `
You are Louis.Ai. Find public business leads from the web for outreach campaigns.

Return STRICT JSON ONLY in this exact shape:
{
  "leads": [
    {
      "company_name": "string",
      "contact_name": "string",
      "contact_title": "string",
      "email": "string",
      "website": "string",
      "location": "string",
      "niche": "string",
      "source_url": "string",
      "confidence": 0.0,
      "notes": "string"
    }
  ],
  "notes": "string"
}

Rules:
- Return up to ${limit} leads
- Use public web information only
- Prefer real companies over generic directories
- If an email is not confidently available, leave it empty
- confidence must be between 0 and 1
- JSON only
- No markdown
- No commentary outside JSON

Lead search request:
${query}
`.trim();

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      tools: [{ type: "web_search_preview" as any }],
      input: prompt,
    } as any);

    const text =
      typeof (resp as any)?.output_text === "string" && (resp as any).output_text.trim().length > 0
        ? (resp as any).output_text.trim()
        : "";

    const parsed = extractJsonFromText(text) ?? {};
    const rawLeads = Array.isArray(parsed?.leads) ? parsed.leads : [];
    const leads = rawLeads.map(normalizeLead).filter(Boolean).slice(0, limit) as LeadRow[];
    const notes = clampString(parsed?.notes ?? "", 1000);

    if (leads.length === 0) {
      return Response.json({ ok: false, error: "NO_LEADS_FOUND" }, { status: 404 });
    }

    const campaignId = makeId("ocmp");
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO outreach_campaigns
       (id, agency_id, user_id, title, description, status, source_query, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      campaignId,
      ctx.agencyId,
      ctx.userId,
      title,
      description || notes || null,
      query,
      now,
      now
    );

    for (const lead of leads) {
      const leadId = makeId("old");
      await db.run(
        `INSERT INTO outreach_leads
         (id, campaign_id, agency_id, user_id, company_name, contact_name, contact_title, email, website, location, niche, source_url, confidence, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
        leadId,
        campaignId,
        ctx.agencyId,
        ctx.userId,
        lead.company_name,
        lead.contact_name || null,
        lead.contact_title || null,
        lead.email || null,
        lead.website || null,
        lead.location || null,
        lead.niche || null,
        lead.source_url || null,
        typeof lead.confidence === "number" ? lead.confidence : null,
        lead.notes || null,
        now,
        now
      );
    }

    return Response.json({
      ok: true,
      campaign_id: campaignId,
      campaign: {
        id: campaignId,
        title,
        description: description || notes || "",
        status: "active",
        source_query: query,
        created_at: now,
        updated_at: now,
      },
      leads,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("OUTREACH_FIND_LEADS_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}