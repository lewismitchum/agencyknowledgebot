import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export async function addConversationMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string
) {
  const db: any = await getDb();

  await db.run(
    `INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    randomUUID(),
    conversationId,
    role,
    content,
    new Date().toISOString()
  );
}

export async function getRecentConversationMessages(
  conversationId: string,
  limit = 24
): Promise<ChatMsg[]> {
  const db: any = await getDb();

  const rows = await db.all(
    `SELECT role, content
     FROM conversation_messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    conversationId,
    limit
  );

  return (rows ?? []).reverse().map((r: any) => ({
    role: (r.role as "user" | "assistant") ?? "user",
    content: String(r.content ?? ""),
  }));
}
