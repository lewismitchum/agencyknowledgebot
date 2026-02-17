import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";


import { getDb } from "@/lib/db";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey });
}

async function safeParseJson(req: NextRequest): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function hasPrepare(db: any): db is { prepare: (sql: string) => any } {
  return db && typeof db.prepare === "function";
}
function hasExecute(db: any): db is { execute: (arg: any) => Promise<any> } {
  return db && typeof db.execute === "function";
}

async function dbGetOne(db: any, sql: string, args: any[]) {
  if (hasPrepare(db)) {
    return db.prepare(sql).get(...args);
  }
  if (hasExecute(db)) {
    const res = await db.execute({ sql, args });
    return res?.rows?.[0] ?? null;
  }
  throw new Error("DB adapter missing prepare/execute");
}

async function dbAll(db: any, sql: string, args: any[]) {
  if (hasPrepare(db)) {
    return db.prepare(sql).all(...args);
  }
  if (hasExecute(db)) {
    const res = await db.execute({ sql, args });
    return res?.rows ?? [];
  }
  throw new Error("DB adapter missing prepare/execute");
}

async function dbRun(db: any, sql: string, args: any[]) {
  if (hasPrepare(db)) {
    return db.prepare(sql).run(...args);
  }
  if (hasExecute(db)) {
    return db.execute({ sql, args });
  }
  throw new Error("DB adapter missing prepare/execute");
}

export async function POST(req: NextRequest) {
  const body = await safeParseJson(req);
  const botId: unknown = body?.bot_id;

  if (!botId || typeof botId !== "string") {
    return json(400, { error: "bot_id is required" });
  }

  // Auth
  let session: any;
  try {
    session = await getSessionFromRequest(req);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return json(401, { error: msg });
  }

  const userId: unknown = session?.user?.id;
  const agencyId: unknown = session?.user?.agency_id;

  if (typeof userId !== "string" || typeof agencyId !== "string") {
    return json(401, { error: "Unauthorized" });
  }

  // ✅ adapter-safe DB (and we avoid trusting its TS type)
  const db: any = await getDb();

  const bot = (await dbGetOne(
    db,
    `
      SELECT id, name, owner_user_id, agency_id, vector_store_id
      FROM bots
      WHERE id = ?
        AND agency_id = ?
        AND (owner_user_id IS NULL OR owner_user_id = ?)
      LIMIT 1
    `,
    [botId, agencyId, userId]
  )) as
    | {
        id: string;
        name: string;
        owner_user_id: string | null;
        agency_id: string;
        vector_store_id: string | null;
      }
    | null;

  if (!bot) {
    return json(404, { error: "Bot not found" });
  }

  const openai = getOpenAI();

  // 1) Validate or create vector store
  let vectorStoreId: string | null = bot.vector_store_id;

  if (vectorStoreId) {
    try {
      await openai.vectorStores.retrieve(vectorStoreId);
    } catch {
      vectorStoreId = null;
    }
  }

  if (!vectorStoreId) {
    try {
      const vs = await openai.vectorStores.create({
        name: `${bot.name} (${bot.id})`,
      });

      vectorStoreId = vs.id;

      await dbRun(
        db,
        `UPDATE bots SET vector_store_id = ? WHERE id = ? AND agency_id = ?`,
        [vectorStoreId, bot.id, agencyId]
      );
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : "Failed to create vector store (check OpenAI billing/quota)";
      return json(402, { error: msg });
    }
  }

  // 2) Best-effort reattach docs
  let attached = 0;
  let skipped = 0;
  let fileIdColumn: string | null = null;

  try {
    const cols = (await dbAll(db, `PRAGMA table_info(documents)`, [])) as Array<{
      name?: string;
    }>;

    const candidates = [
      "openai_file_id",
      "file_id",
      "openaiFileId",
      "remote_file_id",
    ];

    const found = candidates.find((c) => cols.some((x) => x?.name === c));
    if (found) fileIdColumn = found;

    if (fileIdColumn) {
      const rows = (await dbAll(
        db,
        `
          SELECT ${fileIdColumn} AS file_id
          FROM documents
          WHERE bot_id = ?
            AND ${fileIdColumn} IS NOT NULL
            AND TRIM(${fileIdColumn}) <> ''
        `,
        [bot.id]
      )) as Array<{ file_id: string }>;

      for (const r of rows) {
        try {
          await openai.vectorStores.files.create(vectorStoreId, {
            file_id: r.file_id,
          });
          attached += 1;
        } catch {
          skipped += 1;
        }
      }
    }
  } catch {
    // best-effort only
  }

  return json(200, {
    ok: true,
    vector_store_id: vectorStoreId,
    attached,
    skipped,
    file_id_column: fileIdColumn,
  });
}
