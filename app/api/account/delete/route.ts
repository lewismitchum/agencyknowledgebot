import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

async function hasColumn(db: Db, table: string, column: string) {
  try {
    const rows = (await db.all(`PRAGMA table_info(${table})`)) as Array<{ name?: string }>;
    return rows.some((r) => String(r?.name ?? "").trim() === column);
  } catch {
    return false;
  }
}

async function deletePrivateBotsAndDocs(db: Db, agencyId: string, userId: string) {
  const docsHasBotId = await hasColumn(db, "documents", "bot_id");
  const botsHasOwnerUserId = await hasColumn(db, "bots", "owner_user_id");
  const scheduleEventsHasBotId = await hasColumn(db, "schedule_events", "bot_id");
  const scheduleTasksHasBotId = await hasColumn(db, "schedule_tasks", "bot_id");
  const extractionsHasBotId = await hasColumn(db, "extractions", "bot_id");

  if (!botsHasOwnerUserId) return;

  const privateBots = (await db.all(
    `SELECT id FROM bots WHERE agency_id = ? AND owner_user_id = ?`,
    agencyId,
    userId
  )) as Array<{ id: string }>;

  const botIds = privateBots.map((b) => String(b.id)).filter(Boolean);

  if (botIds.length > 0) {
    for (const botId of botIds) {
      if (docsHasBotId) {
        await db.run(`DELETE FROM documents WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
      }
      if (scheduleEventsHasBotId) {
        await db.run(`DELETE FROM schedule_events WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
      }
      if (scheduleTasksHasBotId) {
        await db.run(`DELETE FROM schedule_tasks WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
      }
      if (extractionsHasBotId) {
        await db.run(`DELETE FROM extractions WHERE agency_id = ? AND bot_id = ?`, agencyId, botId).catch(() => {});
      }
    }

    await db.run(
      `DELETE FROM bots
       WHERE agency_id = ? AND owner_user_id = ?`,
      agencyId,
      userId
    ).catch(() => {});
  }
}

async function deleteUserScopedRows(db: Db, agencyId: string, userId: string) {
  const usersHasIdentityId = await hasColumn(db, "users", "identity_id");
  const emailAccountsHasUserId = await hasColumn(db, "email_accounts", "user_id");
  const emailDraftsHasUserId = await hasColumn(db, "email_drafts", "user_id");
  const emailSendEventsHasUserId = await hasColumn(db, "email_send_events", "user_id");
  const notificationsHasUserId = await hasColumn(db, "notifications", "user_id");
  const prefsHasUserId = await hasColumn(db, "schedule_prefs", "user_id");
  const legacyPrefsHasUserId = await hasColumn(db, "schedule_preferences", "user_id");
  const conversationsHasUserId = await hasColumn(db, "conversations", "user_id");
  const messagesHasConversationId = await hasColumn(db, "conversation_messages", "conversation_id");

  if (conversationsHasUserId && messagesHasConversationId) {
    const convoRows = (await db.all(
      `SELECT id FROM conversations WHERE agency_id = ? AND user_id = ?`,
      agencyId,
      userId
    )) as Array<{ id: string }>;

    for (const row of convoRows) {
      await db.run(`DELETE FROM conversation_messages WHERE conversation_id = ?`, row.id).catch(() => {});
    }

    await db.run(`DELETE FROM conversations WHERE agency_id = ? AND user_id = ?`, agencyId, userId).catch(() => {});
  }

  if (notificationsHasUserId) {
    await db.run(`DELETE FROM notifications WHERE agency_id = ? AND user_id = ?`, agencyId, userId).catch(() => {});
  }

  if (prefsHasUserId) {
    await db.run(`DELETE FROM schedule_prefs WHERE agency_id = ? AND user_id = ?`, agencyId, userId).catch(() => {});
  }

  if (legacyPrefsHasUserId) {
    await db.run(`DELETE FROM schedule_preferences WHERE agency_id = ? AND user_id = ?`, agencyId, userId).catch(() => {});
  }

  if (emailDraftsHasUserId) {
    await db.run(`DELETE FROM email_drafts WHERE agency_id = ? AND user_id = ?`, agencyId, userId).catch(() => {});
  }

  if (emailSendEventsHasUserId) {
    await db.run(`DELETE FROM email_send_events WHERE agency_id = ? AND user_id = ?`, agencyId, userId).catch(() => {});
  }

  if (emailAccountsHasUserId) {
    await db.run(`DELETE FROM email_accounts WHERE agency_id = ? AND user_id = ?`, agencyId, userId).catch(() => {});
  }

  if (usersHasIdentityId) {
    await db.run(`UPDATE users SET identity_id = NULL WHERE agency_id = ? AND id = ?`, agencyId, userId).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
    const confirm = String(body?.confirm ?? "").trim();

    if (confirm !== CONFIRM_PHRASE) {
      return NextResponse.json(
        { ok: false, error: "BAD_CONFIRM", message: `Type ${CONFIRM_PHRASE} to continue.` },
        { status: 400 }
      );
    }

    if (ctx.role === "owner") {
      const ownerCountRow = (await db.get(
        `SELECT COUNT(*) as c
         FROM users
         WHERE agency_id = ?
           AND LOWER(COALESCE(role, 'member')) = 'owner'
           AND LOWER(COALESCE(status, 'pending')) = 'active'`,
        ctx.agencyId
      )) as { c?: number | string } | undefined;

      const ownerCount = Number(ownerCountRow?.c ?? 0);

      if (ownerCount <= 1) {
        return NextResponse.json(
          {
            ok: false,
            error: "LAST_OWNER",
            message: "You are the last active owner. Delete the workspace instead, or transfer ownership first.",
          },
          { status: 400 }
        );
      }
    }

    await deletePrivateBotsAndDocs(db, ctx.agencyId, ctx.userId);
    await deleteUserScopedRows(db, ctx.agencyId, ctx.userId);

    await db.run(
      `DELETE FROM users
       WHERE agency_id = ? AND id = ?`,
      ctx.agencyId,
      ctx.userId
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    console.error("ACCOUNT_DELETE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}