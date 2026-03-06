// app/api/extractions/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function clampString(s: string, max: number) {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

async function hasColumn(db: Db, table: string, column: string) {
  try {
    const rows = (await db.all(`PRAGMA table_info(${table})`)) as Array<{ name?: string }>;
    return rows.some((r) => String(r?.name ?? "").trim() === column);
  } catch {
    return false;
  }
}

async function ensureExtractionsTitleColumn(db: Db) {
  const exists = await hasColumn(db, "extractions", "title");
  if (exists) return;

  try {
    await db.run(`ALTER TABLE extractions ADD COLUMN title TEXT`);
  } catch {
    // ignore if already added by another request/process
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureExtractionsTitleColumn(db);

    const url = new URL(req.url);
    const bot_id = String(url.searchParams.get("bot_id") || "").trim();

    const rows = bot_id
      ? await db.all(
          `SELECT
             e.id,
             e.agency_id,
             e.bot_id,
             e.document_id,
             e.title,
             e.created_at,
             COALESCE(NULLIF(TRIM(e.title), ''), NULLIF(TRIM(d.title), ''), 'Extraction') AS display_title
           FROM extractions e
           LEFT JOIN documents d
             ON d.id = e.document_id
            AND d.agency_id = e.agency_id
           WHERE e.agency_id = ? AND e.bot_id = ?
           ORDER BY e.created_at DESC`,
          ctx.agencyId,
          bot_id
        )
      : await db.all(
          `SELECT
             e.id,
             e.agency_id,
             e.bot_id,
             e.document_id,
             e.title,
             e.created_at,
             COALESCE(NULLIF(TRIM(e.title), ''), NULLIF(TRIM(d.title), ''), 'Extraction') AS display_title
           FROM extractions e
           LEFT JOIN documents d
             ON d.id = e.document_id
            AND d.agency_id = e.agency_id
           WHERE e.agency_id = ?
           ORDER BY e.created_at DESC`,
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

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureExtractionsTitleColumn(db);

    const body = (await req.json().catch(() => null)) as { id?: string; title?: string; name?: string } | null;
    const id = String(body?.id ?? "").trim();
    const title = clampString(body?.title ?? body?.name ?? "", 200);

    if (!id) return Response.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
    if (!title) return Response.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });

    const row = (await db.get(
      `SELECT id
       FROM extractions
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      id,
      ctx.agencyId
    )) as { id: string } | undefined;

    if (!row?.id) return Response.json({ ok: false, error: "EXTRACTION_NOT_FOUND" }, { status: 404 });

    await db.run(
      `UPDATE extractions
       SET title = ?
       WHERE id = ? AND agency_id = ?`,
      title,
      id,
      ctx.agencyId
    );

    return Response.json({ ok: true, id, title });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("EXTRACTIONS_PATCH_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureExtractionsTitleColumn(db);

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