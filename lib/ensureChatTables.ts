// lib/ensureChatTables.ts
import { getDb } from "@/lib/db";

/**
 * Chat schema bootstrap / drift self-heal.
 *
 * IMPORTANT:
 * - Do NOT wrap this in BEGIN/COMMIT transactions.
 * - SQLite/libSQL can implicitly end a transaction on DDL, causing
 *   "cannot commit - no transaction is active" elsewhere.
 *
 * Also: some older prod DBs may have conversations.owner_user_id instead of conversations.user_id.
 * We add user_id idempotently so modern queries don't crash.
 */

let didInit = false;

async function tryExec(db: any, sql: string) {
  try {
    await db.exec(sql);
    return true;
  } catch {
    try {
      await db.run(sql);
      return true;
    } catch {
      return false;
    }
  }
}

export async function ensureChatTables() {
  if (didInit) return;

  const db: any = await getDb();

  // --- conversations table (needed for chat history + memory refresh) ---
  await tryExec(
    db,
    `
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT,
      owner_user_id TEXT,
      bot_id TEXT NOT NULL,
      summary TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `
  );

  // Drift fixes: add columns if missing (ignore if already exists)
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN agency_id TEXT;`);
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN user_id TEXT;`);
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN owner_user_id TEXT;`);
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN bot_id TEXT;`);
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN summary TEXT;`);
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;`);
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN created_at TEXT;`);
  await tryExec(db, `ALTER TABLE conversations ADD COLUMN updated_at TEXT;`);

  // Helpful indexes (safe no-ops if already exist)
  await tryExec(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_conversations_agency_user_bot
    ON conversations (agency_id, user_id, bot_id)
  `
  );
  await tryExec(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_conversations_agency_owner_bot
    ON conversations (agency_id, owner_user_id, bot_id)
  `
  );
  await tryExec(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_conversations_updated
    ON conversations (agency_id, updated_at)
  `
  );

  // --- conversation_messages table ---
  await tryExec(
    db,
    `
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL, -- "user" | "assistant"
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `
  );

  // Drift fixes for messages
  await tryExec(db, `ALTER TABLE conversation_messages ADD COLUMN role TEXT;`);
  await tryExec(db, `ALTER TABLE conversation_messages ADD COLUMN content TEXT;`);
  await tryExec(db, `ALTER TABLE conversation_messages ADD COLUMN created_at TEXT;`);

  await tryExec(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_convo_msgs_convo_time
    ON conversation_messages (conversation_id, created_at)
  `
  );

  didInit = true;
}