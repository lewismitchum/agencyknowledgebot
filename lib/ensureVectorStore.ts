import { openai } from "@/lib/openai";
import { getDb } from "@/lib/db";

/**
 * Ensures a bot has a vector_store_id.
 * - Returns existing if present
 * - Otherwise creates a new vector store and persists it
 */
export async function ensureBotVectorStoreId(params: {
  botId: string;
  agencyId: string;
  botName?: string | null;
}) {
  const { botId, agencyId, botName } = params;
  const db: any = await getDb();

  const row = await db.get(
    `SELECT id, vector_store_id, name
     FROM bots
     WHERE id = ? AND agency_id = ?
     LIMIT 1`,
    botId,
    agencyId
  );

  if (!row?.id) return { ok: false as const, vector_store_id: null as string | null, reason: "not_found" };
  if (row.vector_store_id) return { ok: true as const, vector_store_id: row.vector_store_id as string };

  // create
  const vs = await openai.vectorStores.create({
    name: `bot:${String(botName || row.name || botId)}`.slice(0, 80),
  });

  const vsId = String(vs?.id ?? "").trim();
  if (!vsId) return { ok: false as const, vector_store_id: null as string | null, reason: "create_failed" };

  await db.run(
    `UPDATE bots SET vector_store_id = ? WHERE id = ? AND agency_id = ?`,
    vsId,
    botId,
    agencyId
  );

  return { ok: true as const, vector_store_id: vsId };
}
