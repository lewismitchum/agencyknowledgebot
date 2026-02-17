import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export type BotRow = {
  id: string;
  agency_id: string;
  owner_user_id: string | null;
  name: string;
  description: string | null;
  vector_store_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function getOrCreatePrivateUserBot(
  agencyId: string,
  userId: string
): Promise<BotRow> {
  const db = await getDb();

  const existing = await db.get<BotRow>(
    `select id, agency_id, owner_user_id, name, description, vector_store_id, created_at, updated_at
     from bots
     where agency_id = ? and owner_user_id = ?
     order by created_at desc
     limit 1`,
    agencyId,
    userId
  );

  if (existing) return existing;

  const id = randomUUID();
  const name = "My Private Bot";

  await db.run(
    `insert into bots (id, agency_id, owner_user_id, name, description, vector_store_id)
     values (?, ?, ?, ?, ?, ?)`,
    id,
    agencyId,
    userId,
    name,
    "Private, user-scoped bot. Only your uploads are visible here.",
    null // stays null until billing/vector store writes are enabled
  );

  const created = await db.get<BotRow>(
    `select id, agency_id, owner_user_id, name, description, vector_store_id, created_at, updated_at
     from bots
     where id = ?
     limit 1`,
    id
  );

  if (!created) throw new Error("BOT_CREATE_FAILED");
  return created;
}
