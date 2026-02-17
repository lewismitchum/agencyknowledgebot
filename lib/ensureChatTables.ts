// lib/ensureChatTables.ts
import { getDb } from "@/lib/db";

let didInit = false;

export async function ensureChatTables() {
  if (didInit) return;
  didInit = true;

  const db: any = await getDb();

  await db.run(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL, -- "user" | "assistant"
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_convo_msgs_convo_time
    ON conversation_messages (conversation_id, created_at)
  `);
}
