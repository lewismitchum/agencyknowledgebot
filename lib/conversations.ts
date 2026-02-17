import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export type Conversation = {
  id: string;
  user_id: string;
  bot_id: string;
  summary: string;
  message_count: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export async function getOrCreateConversation(
  userId: string,
  botId: string
): Promise<Conversation> {
  const db: any = await getDb();

  const existing = await db.get(
    `select id, user_id, bot_id, summary, message_count, created_at, updated_at
     from conversations
     where user_id = ? and bot_id = ?
     limit 1`,
    userId,
    botId
  );

  if (existing) return existing as Conversation;

  const id = randomUUID();
  const nowIso = new Date().toISOString();

  await db.run(
    `insert into conversations (
      id, user_id, bot_id, summary, message_count, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    botId,
    "",
    0,
    nowIso,
    nowIso
  );

  return {
    id,
    user_id: userId,
    bot_id: botId,
    summary: "",
    message_count: 0,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export async function incrementMessageCount(conversationId: string) {
  const db: any = await getDb();
  const nowIso = new Date().toISOString();

  await db.run(
    `update conversations
     set message_count = message_count + 1,
         updated_at = ?
     where id = ?`,
    nowIso,
    conversationId
  );
}

export async function setConversationSummary(conversationId: string, summary: string) {
  const db: any = await getDb();

  await db.run(
    `UPDATE conversations
     SET summary = ?, message_count = 0, updated_at = ?
     WHERE id = ?`,
    summary,
    new Date().toISOString(),
    conversationId
  );
}
export async function resetConversation(conversationId: string) {
  const db: any = await getDb();
  const nowIso = new Date().toISOString();

  await db.run(
    `update conversations
     set summary = '',
         message_count = 0,
         updated_at = ?
     where id = ?`,
    nowIso,
    conversationId
  );
}
