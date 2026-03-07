import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireOwner } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM_PHRASE = "DELETE WORKSPACE";

async function hasTable(db: Db, table: string) {
  try {
    const row = (await db.get(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = ?
       LIMIT 1`,
      table
    )) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

async function hasColumn(db: Db, table: string, column: string) {
  try {
    const rows = (await db.all(`PRAGMA table_info(${table})`)) as Array<{ name?: string }>;
    return rows.some((r) => String(r?.name ?? "").trim() === column);
  } catch {
    return false;
  }
}

async function deleteIfTable(db: Db, table: string, sql: string, ...args: any[]) {
  const exists = await hasTable(db, table);
  if (!exists) return;
  await db.run(sql, ...args).catch(() => {});
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOwner(req);
    const db = await getDb();
    await ensureSchema(db);

    const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
    const confirm = String(body?.confirm ?? "").trim();

    const agencyRow = (await db.get(
      `SELECT name
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { name?: string | null } | undefined;

    const agencyName = String(agencyRow?.name ?? "").trim();

    const confirmMatches =
      confirm === CONFIRM_PHRASE || (!!agencyName && confirm === agencyName);

    if (!confirmMatches) {
      return NextResponse.json(
        {
          ok: false,
          error: "BAD_CONFIRM",
          message: `Type ${CONFIRM_PHRASE} or the workspace name to continue.`,
        },
        { status: 400 }
      );
    }

    const docsHasBotId = await hasColumn(db, "documents", "bot_id");
    const scheduleEventsHasBotId = await hasColumn(db, "schedule_events", "bot_id");
    const scheduleTasksHasBotId = await hasColumn(db, "schedule_tasks", "bot_id");
    const extractionsHasBotId = await hasColumn(db, "extractions", "bot_id");
    const conversationsHasAgencyId = await hasColumn(db, "conversations", "agency_id");
    const conversationsHasId = await hasColumn(db, "conversations", "id");
    const messagesHasConversationId = await hasColumn(db, "conversation_messages", "conversation_id");

    if (conversationsHasAgencyId && conversationsHasId && messagesHasConversationId) {
      const convoRows = (await db.all(
        `SELECT id FROM conversations WHERE agency_id = ?`,
        ctx.agencyId
      )) as Array<{ id: string }>;

      for (const row of convoRows) {
        await db.run(`DELETE FROM conversation_messages WHERE conversation_id = ?`, row.id).catch(() => {});
      }

      await db.run(`DELETE FROM conversations WHERE agency_id = ?`, ctx.agencyId).catch(() => {});
    }

    await deleteIfTable(db, "notifications", `DELETE FROM notifications WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "email_send_events", `DELETE FROM email_send_events WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "email_drafts", `DELETE FROM email_drafts WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "email_accounts", `DELETE FROM email_accounts WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "support_tickets", `DELETE FROM support_tickets WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "usage_daily", `DELETE FROM usage_daily WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "schedule_prefs", `DELETE FROM schedule_prefs WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "schedule_preferences", `DELETE FROM schedule_preferences WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "agency_invites", `DELETE FROM agency_invites WHERE agency_id = ?`, ctx.agencyId);

    if (scheduleTasksHasBotId) {
      await deleteIfTable(db, "schedule_tasks", `DELETE FROM schedule_tasks WHERE agency_id = ?`, ctx.agencyId);
    } else {
      await deleteIfTable(db, "schedule_tasks", `DELETE FROM schedule_tasks WHERE agency_id = ?`, ctx.agencyId);
    }

    if (scheduleEventsHasBotId) {
      await deleteIfTable(db, "schedule_events", `DELETE FROM schedule_events WHERE agency_id = ?`, ctx.agencyId);
    } else {
      await deleteIfTable(db, "schedule_events", `DELETE FROM schedule_events WHERE agency_id = ?`, ctx.agencyId);
    }

    if (extractionsHasBotId) {
      await deleteIfTable(db, "extractions", `DELETE FROM extractions WHERE agency_id = ?`, ctx.agencyId);
    } else {
      await deleteIfTable(db, "extractions", `DELETE FROM extractions WHERE agency_id = ?`, ctx.agencyId);
    }

    if (docsHasBotId) {
      await deleteIfTable(db, "documents", `DELETE FROM documents WHERE agency_id = ?`, ctx.agencyId);
    } else {
      await deleteIfTable(db, "documents", `DELETE FROM documents WHERE agency_id = ?`, ctx.agencyId);
    }

    await deleteIfTable(db, "bots", `DELETE FROM bots WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "users", `DELETE FROM users WHERE agency_id = ?`, ctx.agencyId);
    await deleteIfTable(db, "agencies", `DELETE FROM agencies WHERE id = ?`, ctx.agencyId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    if (code === "FORBIDDEN_NOT_ACTIVE" || code === "FORBIDDEN_NOT_OWNER") {
      return NextResponse.json({ ok: false, error: code }, { status: 403 });
    }

    console.error("WORKSPACE_DELETE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}