// app/api/extractions/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const url = new URL(req.url);
    const bot_id = String(url.searchParams.get("bot_id") || "").trim();

    const rows = bot_id
      ? await db.all(
          `SELECT id, agency_id, bot_id, document_id, created_at
           FROM extractions
           WHERE agency_id = ? AND bot_id = ?
           ORDER BY created_at DESC`,
          ctx.agencyId,
          bot_id
        )
      : await db.all(
          `SELECT id, agency_id, bot_id, document_id, created_at
           FROM extractions
           WHERE agency_id = ?
           ORDER BY created_at DESC`,
          ctx.agencyId
        );

    return Response.json({ ok: true, extractions: rows ?? [] });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("EXTRACTIONS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as any;
    const id = String(body?.id ?? "").trim();
    if (!id) return Response.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const row = (await db.get(
      `SELECT id
       FROM extractions
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "EXTRACTION_NOT_FOUND" }, { status: 404 });

    await db.run(`DELETE FROM extractions WHERE id = ? AND agency_id = ?`, id, ctx.agencyId);

    return Response.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("EXTRACTIONS_DELETE_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}