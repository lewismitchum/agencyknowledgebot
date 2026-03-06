// app/api/documents/[id]/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

type RenameBody = {
  title?: string;
  name?: string;
};

function clampString(s: string, max: number) {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireActiveMember(req);
    const { id } = await ctx.params;

    const docId = String(id ?? "").trim();
    if (!docId) {
      return Response.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as RenameBody | null;
    const nextTitle = clampString(body?.title ?? body?.name ?? "", 200);

    if (!nextTitle) {
      return Response.json({ ok: false, error: "Missing title" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    const doc = (await db.get(
      `SELECT id, agency_id, bot_id, title
       FROM documents
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      docId,
      auth.agencyId
    )) as
      | {
          id: string;
          agency_id: string;
          bot_id: string | null;
          title: string | null;
        }
      | undefined;

    if (!doc?.id) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (!doc.bot_id) {
      return Response.json({ ok: false, error: "Document is missing bot_id" }, { status: 409 });
    }

    const bot = (await db.get(
      `SELECT id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      doc.bot_id,
      auth.agencyId,
      auth.userId
    )) as { id: string } | undefined;

    if (!bot?.id) {
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    await db.run(
      `UPDATE documents
       SET title = ?
       WHERE id = ? AND agency_id = ?`,
      nextTitle,
      docId,
      auth.agencyId
    );

    return Response.json({
      ok: true,
      id: docId,
      title: nextTitle,
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    console.error("RENAME_DOCUMENT_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireActiveMember(req);
    const { id } = await ctx.params;

    const docId = String(id ?? "").trim();
    if (!docId) {
      return Response.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    const doc = (await db.get(
      `SELECT id, agency_id, bot_id, title, openai_file_id
       FROM documents
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      docId,
      auth.agencyId
    )) as
      | {
          id: string;
          agency_id: string;
          bot_id: string | null;
          title: string | null;
          openai_file_id: string | null;
        }
      | undefined;

    if (!doc?.id) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (!doc.bot_id) {
      return Response.json({ ok: false, error: "Document is missing bot_id" }, { status: 409 });
    }

    const bot = (await db.get(
      `SELECT id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
         AND (owner_user_id IS NULL OR owner_user_id = ?)
       LIMIT 1`,
      doc.bot_id,
      auth.agencyId,
      auth.userId
    )) as { id: string; vector_store_id: string | null } | undefined;

    if (!bot?.id) {
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    if (doc.openai_file_id && bot.vector_store_id) {
      try {
        await openai.vectorStores.files.delete(String(doc.openai_file_id), {
          vector_store_id: bot.vector_store_id,
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (!/not[\s-]?found|404/i.test(msg)) {
          return Response.json(
            { ok: false, error: "Failed to delete file from vector store", message: msg },
            { status: 502 }
          );
        }
      }
    }

    await db.run(`DELETE FROM schedule_events WHERE agency_id = ? AND document_id = ?`, auth.agencyId, docId);
    await db.run(`DELETE FROM schedule_tasks WHERE agency_id = ? AND document_id = ?`, auth.agencyId, docId);
    await db.run(`DELETE FROM extractions WHERE agency_id = ? AND document_id = ?`, auth.agencyId, docId).catch(
      () => {}
    );

    await db.run(`DELETE FROM documents WHERE id = ? AND agency_id = ?`, docId, auth.agencyId);

    return Response.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    console.error("DELETE_DOCUMENT_ERROR", err);
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}