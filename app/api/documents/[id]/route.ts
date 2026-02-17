// app/api/documents/[id]/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireActiveMember(req);
    const { id } = await ctx.params;

    const docId = String(id ?? "").trim();
    if (!docId) {
      return Response.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const db: Db = await getDb();

    // Load doc, ensure it belongs to this agency.
    const doc = (await db.get(
      `SELECT id, agency_id, bot_id, filename, openai_file_id
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
          filename: string | null;
          openai_file_id: string | null;
        }
      | undefined;

    if (!doc?.id) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (!doc.bot_id) {
      return Response.json({ ok: false, error: "Document is missing bot_id" }, { status: 409 });
    }

    // Ensure the bot exists, is in this agency, and the user is allowed to access it.
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

    // Best-effort remove from vector store first.
    if (doc.openai_file_id && bot.vector_store_id) {
      try {
        // Pass the file ID as the first argument and the FileDeleteParams as the second
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

    // Delete derived schedule data for this doc (prevents orphaned events/tasks)
    await db.run(
      `DELETE FROM schedule_events WHERE agency_id = ? AND source_document_id = ?`,
      auth.agencyId,
      docId
    );
    await db.run(
      `DELETE FROM schedule_tasks WHERE agency_id = ? AND source_document_id = ?`,
      auth.agencyId,
      docId
    );

    // Delete extraction logs for this doc (if table exists)
    await db.run(
      `DELETE FROM extractions WHERE agency_id = ? AND document_id = ?`,
      auth.agencyId,
      docId
    ).catch(() => {});

    // Now delete DB row
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
    return Response.json(
      { error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
