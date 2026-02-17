// app/api/upload/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";

function nowIso() {
  return new Date().toISOString();
}

async function getFallbackBotId(db: Db, agencyId: string, userId: string) {
  // Prefer latest agency bot
  const agencyBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId
  )) as { id: string } | undefined;

  if (agencyBot?.id) return agencyBot.id;

  // Fall back to latest user bot
  const userBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId,
    userId
  )) as { id: string } | undefined;

  return userBot?.id ?? null;
}

async function assertBotAccessAndGetVectorStore(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, name, vector_store_id, owner_user_id, agency_id
     FROM bots
     WHERE id = ? AND agency_id = ?
       AND (owner_user_id IS NULL OR owner_user_id = ?)
     LIMIT 1`,
    args.bot_id,
    args.agency_id,
    args.user_id
  )) as
    | { id: string; name: string; vector_store_id: string | null; owner_user_id: string | null; agency_id: string }
    | undefined;

  if (!bot?.id) return { ok: false as const, error: "BOT_NOT_FOUND" as const };

  if (!bot.vector_store_id) {
    return {
      ok: false as const,
      error: "BOT_VECTOR_STORE_MISSING" as const,
      bot_id: bot.id,
    };
  }

  return { ok: true as const, bot, vector_store_id: bot.vector_store_id };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const form = await req.formData();
    const files = form.getAll("files") as File[];

    if (!files?.length) {
      return Response.json({ ok: false, error: "No files uploaded" }, { status: 400 });
    }

    const db: Db = await getDb();

    // Allow bot_id from client, but fallback safely if missing
    let bot_id = String(form.get("bot_id") ?? "").trim();
    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) {
        return Response.json({ ok: false, error: "No bots found for this agency/user" }, { status: 404 });
      }
      bot_id = fallback;
    }

    const ensured = await assertBotAccessAndGetVectorStore(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    if (!ensured.ok) {
      if (ensured.error === "BOT_VECTOR_STORE_MISSING") {
        return Response.json(
          {
            ok: false,
            error: "This bot can’t accept uploads yet (vector store missing).",
            code: "BOT_VECTOR_STORE_MISSING",
            bot_id,
          },
          { status: 409 }
        );
      }
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    const vectorStoreId = ensured.vector_store_id;

    const uploaded: Array<{ document_id: string; filename: string; openai_file_id: string }> = [];

    for (const file of files) {
      // 1) Upload file to OpenAI Files API
      const uploadedFile = await openai.files.create({
        file,
        purpose: "assistants",
      });

      // 2) Attach file to the bot's vector store
      const vsFile = await openai.vectorStores.files.create(vectorStoreId, {
        file_id: uploadedFile.id,
      });

      // 3) Poll until indexed
      const start = Date.now();
      while (true) {
        const cur = await openai.vectorStores.files.retrieve(vsFile.id, {
          vector_store_id: vectorStoreId,
        });

        if (cur.status === "completed") break;

        if (cur.status === "failed") {
          throw new Error(`Indexing failed for ${file.name}`);
        }

        if (Date.now() - start > 120_000) {
          throw new Error(`Indexing timed out for ${file.name}`);
        }

        await new Promise((r) => setTimeout(r, 1500));
      }

      // 4) Save metadata in DB
      const created_at = nowIso();

      await db.run(
        `INSERT INTO documents (id, agency_id, bot_id, filename, openai_file_id, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)`,
        ctx.agencyId,
        bot_id,
        file.name,
        uploadedFile.id,
        created_at
      );

      const row = (await db.get(
        `SELECT id
         FROM documents
         WHERE agency_id = ? AND bot_id = ? AND openai_file_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        ctx.agencyId,
        bot_id,
        uploadedFile.id
      )) as { id: string } | undefined;

      uploaded.push({
        document_id: row?.id ?? "",
        filename: file.name,
        openai_file_id: uploadedFile.id,
      });
    }

    return Response.json({ ok: true, bot_id, uploaded });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("UPLOAD_ERROR", err);

    const msg = String(err?.message || "");
    const isBilling =
      msg.toLowerCase().includes("quota") ||
      msg.toLowerCase().includes("billing") ||
      msg.toLowerCase().includes("payment") ||
      msg.includes("You exceeded your current quota") ||
      msg.includes("429");

    return Response.json(
      {
        ok: false,
        error: isBilling ? "OpenAI billing/quota required to upload documents" : "Server error",
        message: msg,
      },
      { status: isBilling ? 402 : 500 }
    );
  }
}
