// app/api/outreach/campaigns/[id]/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

type PatchBody = {
  lead_id?: string;
  status?: string;
  notes?: string;
};

const ALLOWED_STATUSES = new Set([
  "new",
  "reviewed",
  "approved",
  "rejected",
  "drafted",
  "sent",
  "replied",
  "bounced",
  "do_not_contact",
]);

function clampString(s: string, max: number) {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(plan);
    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const { id } = await ctx.params;
    const campaignId = clampString(id ?? "", 200);
    if (!campaignId) return Response.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    const campaign = (await db.get(
      `SELECT id, title, description, status, source_query, created_at, updated_at
       FROM outreach_campaigns
       WHERE id = ? AND agency_id = ? AND user_id = ?
       LIMIT 1`,
      campaignId,
      session.agencyId,
      session.userId
    )) as
      | {
          id: string;
          title: string;
          description: string | null;
          status: string;
          source_query: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!campaign?.id) {
      return Response.json({ ok: false, error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
    }

    const leads = (await db.all(
      `SELECT
         id,
         company_name,
         contact_name,
         contact_title,
         email,
         website,
         location,
         niche,
         source_url,
         confidence,
         status,
         last_contacted_at,
         replied_at,
         notes,
         created_at,
         updated_at
       FROM outreach_leads
       WHERE campaign_id = ? AND agency_id = ? AND user_id = ?
       ORDER BY created_at DESC`,
      campaignId,
      session.agencyId,
      session.userId
    )) as Array<Record<string, any>>;

    return Response.json({
      ok: true,
      campaign: {
        id: campaign.id,
        title: String(campaign.title || "Campaign"),
        description: campaign.description ? String(campaign.description) : "",
        status: String(campaign.status || "active"),
        source_query: campaign.source_query ? String(campaign.source_query) : "",
        created_at: String(campaign.created_at || ""),
        updated_at: String(campaign.updated_at || ""),
      },
      leads: leads.map((lead) => ({
        id: String(lead.id || ""),
        company_name: String(lead.company_name || ""),
        contact_name: lead.contact_name ? String(lead.contact_name) : "",
        contact_title: lead.contact_title ? String(lead.contact_title) : "",
        email: lead.email ? String(lead.email) : "",
        website: lead.website ? String(lead.website) : "",
        location: lead.location ? String(lead.location) : "",
        niche: lead.niche ? String(lead.niche) : "",
        source_url: lead.source_url ? String(lead.source_url) : "",
        confidence: lead.confidence == null ? null : Number(lead.confidence),
        status: String(lead.status || "new"),
        last_contacted_at: lead.last_contacted_at ? String(lead.last_contacted_at) : "",
        replied_at: lead.replied_at ? String(lead.replied_at) : "",
        notes: lead.notes ? String(lead.notes) : "",
        created_at: String(lead.created_at || ""),
        updated_at: String(lead.updated_at || ""),
      })),
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("OUTREACH_CAMPAIGN_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(plan);
    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const { id } = await ctx.params;
    const campaignId = clampString(id ?? "", 200);
    if (!campaignId) return Response.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    const body = (await req.json().catch(() => null)) as PatchBody | null;
    const leadId = clampString(body?.lead_id ?? "", 200);
    const status = clampString(body?.status ?? "", 50).toLowerCase();
    const notes = clampString(body?.notes ?? "", 2000);

    if (!leadId) return Response.json({ ok: false, error: "MISSING_LEAD_ID" }, { status: 400 });
    if (!ALLOWED_STATUSES.has(status)) {
      return Response.json({ ok: false, error: "INVALID_STATUS" }, { status: 400 });
    }

    const row = (await db.get(
      `SELECT id
       FROM outreach_leads
       WHERE id = ? AND campaign_id = ? AND agency_id = ? AND user_id = ?
       LIMIT 1`,
      leadId,
      campaignId,
      session.agencyId,
      session.userId
    )) as { id: string } | undefined;

    if (!row?.id) {
      return Response.json({ ok: false, error: "LEAD_NOT_FOUND" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const lastContactedAt = status === "sent" ? now : null;
    const repliedAt = status === "replied" ? now : null;

    await db.run(
      `UPDATE outreach_leads
       SET status = ?,
           notes = ?,
           last_contacted_at = COALESCE(?, last_contacted_at),
           replied_at = COALESCE(?, replied_at),
           updated_at = ?
       WHERE id = ? AND campaign_id = ? AND agency_id = ? AND user_id = ?`,
      status,
      notes || null,
      lastContactedAt,
      repliedAt,
      now,
      leadId,
      campaignId,
      session.agencyId,
      session.userId
    );

    await db.run(
      `UPDATE outreach_campaigns
       SET updated_at = ?
       WHERE id = ? AND agency_id = ? AND user_id = ?`,
      now,
      campaignId,
      session.agencyId,
      session.userId
    );

    return Response.json({
      ok: true,
      lead_id: leadId,
      campaign_id: campaignId,
      status,
      updated_at: now,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("OUTREACH_CAMPAIGN_PATCH_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}