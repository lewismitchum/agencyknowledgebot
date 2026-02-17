import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();

    // ✅ Plan gate (server-side)
    const agency = (await db.get(
      `SELECT id, plan
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { id: string; plan: string | null } | null;

    const gate = requireFeature(agency?.plan, "extraction");
    if (!gate.ok) {
      return Response.json(gate.body, { status: gate.status });
    }

    // Conservative select to avoid "no such column" landmines.
    const rows = await db.all(
      `SELECT id, agency_id, bot_id, document_id, created_at
       FROM extractions
       WHERE agency_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      ctx.agencyId
    );

    return Response.json({ ok: true, extractions: rows ?? [] });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED")
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE")
      return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("EXTRACTIONS_GET_ERROR", err);
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
