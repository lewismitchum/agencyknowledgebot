// app/api/settings/account-memory/route.ts
import { type NextRequest } from "next/server";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { ensureMemoryStoreSchema } from "@/lib/chat-memory";

export const runtime = "nodejs";

const SESSION_COOKIE = "louis_session";

function nowIso() {
  return new Date().toISOString();
}

function compact(v: unknown) {
  return String(v ?? "").trim();
}

function jsonWithExpiredSessionCookie(body: any, init?: ResponseInit) {
  const res = Response.json(body, init);
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
  return res;
}

async function tableExists(db: Db, tableName: string) {
  const row = (await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    tableName
  )) as { name?: string } | undefined;
  return !!row?.name;
}

async function getTableColumns(db: Db, tableName: string) {
  try {
    const rows = (await db.all(`PRAGMA table_info(${tableName})`)) as Array<{ name?: string }>;
    return rows.map((r) => String(r.name ?? ""));
  } catch {
    return [];
  }
}

async function columnExists(db: Db, tableName: string, columnName: string) {
  const cols = await getTableColumns(db, tableName);
  return cols.includes(columnName);
}

async function ensureAccountSettingsSchema(db: Db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_account_settings (
      user_id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      display_name TEXT,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.run(`CREATE INDEX IF NOT EXISTS idx_user_account_settings_agency ON user_account_settings(agency_id)`);
}

async function ensureUsersColumns(db: Db) {
  const cols = (await db.all(`PRAGMA table_info(users)`)) as Array<{ name?: string }>;

  const hasDisplayName = cols.some((c) => c?.name === "display_name");
  if (!hasDisplayName) {
    await db.run(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  }

  const hasEmail = cols.some((c) => c?.name === "email");
  if (!hasEmail) {
    await db.run(`ALTER TABLE users ADD COLUMN email TEXT`);
  }
}

async function getUserEmail(db: Db, userId: string) {
  const hasEmail = await columnExists(db, "users", "email");
  if (!hasEmail) return null;

  const row = (await db.get(`SELECT email FROM users WHERE id = ? LIMIT 1`, userId)) as
    | { email?: string | null }
    | undefined;

  return compact(row?.email) || null;
}

async function getUserDisplayName(db: Db, userId: string) {
  const hasDisplayName = await columnExists(db, "users", "display_name");
  if (!hasDisplayName) return null;

  const row = (await db.get(`SELECT display_name FROM users WHERE id = ? LIMIT 1`, userId)) as
    | { display_name?: string | null }
    | undefined;

  return compact(row?.display_name) || null;
}

async function getOrCreateAccountSettings(db: Db, args: { agencyId: string; userId: string }) {
  await ensureAccountSettingsSchema(db);

  const existing = (await db.get(
    `SELECT user_id, display_name, timezone
     FROM user_account_settings
     WHERE user_id = ?
     LIMIT 1`,
    args.userId
  )) as
    | {
        user_id?: string;
        display_name?: string | null;
        timezone?: string | null;
      }
    | undefined;

  if (existing?.user_id) {
    return {
      display_name: compact(existing.display_name),
      timezone: compact(existing.timezone),
    };
  }

  const fallbackName = (await getUserDisplayName(db, args.userId)) ?? "";

  await db.run(
    `INSERT INTO user_account_settings
     (user_id, agency_id, display_name, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    args.userId,
    args.agencyId,
    fallbackName,
    "",
    nowIso(),
    nowIso()
  );

  return {
    display_name: fallbackName,
    timezone: "",
  };
}

async function loadMemories(db: Db, args: { agencyId: string; userId: string }) {
  const rows = (await db.all(
    `SELECT id, scope, bot_id, content, last_used_at, last_updated_at, created_at
     FROM memory_store
     WHERE
       scope = 'system'
       OR (scope = 'agency' AND agency_id = ?)
       OR (scope = 'user' AND agency_id = ? AND user_id = ?)
     ORDER BY
       CASE scope
         WHEN 'system' THEN 0
         WHEN 'agency' THEN 1
         ELSE 2
       END,
       COALESCE(last_updated_at, created_at) DESC`,
    args.agencyId,
    args.agencyId,
    args.userId
  )) as Array<{
    id?: string;
    scope?: string;
    bot_id?: string | null;
    content?: string | null;
    last_used_at?: string | null;
    last_updated_at?: string | null;
    created_at?: string | null;
  }>;

  return rows.map((row) => ({
    id: compact(row.id),
    scope: compact(row.scope),
    bot_id: compact(row.bot_id),
    content: String(row.content ?? ""),
    last_used_at: compact(row.last_used_at),
    last_updated_at: compact(row.last_updated_at),
    created_at: compact(row.created_at),
  }));
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const raw = compact(storedHash);
  if (!raw.startsWith("scrypt:")) return false;

  const parts = raw.split(":");
  if (parts.length !== 3) return false;

  const salt = parts[1];
  const expectedHex = parts[2];

  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

async function getUserPasswordHash(db: Db, userId: string) {
  const hasPasswordHash = await columnExists(db, "users", "password_hash");
  if (!hasPasswordHash) return null;

  const row = (await db.get(`SELECT password_hash FROM users WHERE id = ? LIMIT 1`, userId)) as
    | { password_hash?: string | null }
    | undefined;

  return compact(row?.password_hash) || null;
}

async function userHasSupportedPasswordAuth(db: Db) {
  return await columnExists(db, "users", "password_hash");
}

async function deleteRowsByUserRefs(db: Db, tableName: string, userId: string, agencyId: string) {
  if (!(await tableExists(db, tableName))) return;

  const cols = await getTableColumns(db, tableName);
  if (!cols.length) return;

  const userLikeCols = ["user_id", "owner_user_id", "created_by_user_id", "updated_by_user_id"];
  for (const col of userLikeCols) {
    if (cols.includes(col)) {
      await db.run(`DELETE FROM ${tableName} WHERE ${col} = ?`, userId);
    }
  }

  if (tableName === "memory_store") {
    const hasScope = cols.includes("scope");
    const hasAgencyId = cols.includes("agency_id");
    const hasUserId = cols.includes("user_id");
    if (hasScope && hasAgencyId && hasUserId) {
      await db.run(
        `DELETE FROM memory_store
         WHERE scope = 'user' AND agency_id = ? AND user_id = ?`,
        agencyId,
        userId
      );
    }
  }
}

async function deleteConversationData(db: Db, userId: string) {
  if (!(await tableExists(db, "conversations"))) return;

  const convoIds = (await db.all(
    `SELECT id FROM conversations WHERE owner_user_id = ?`,
    userId
  )) as Array<{ id?: string }>;

  if (await tableExists(db, "conversation_messages")) {
    for (const row of convoIds) {
      if (row?.id) {
        await db.run(`DELETE FROM conversation_messages WHERE conversation_id = ?`, row.id);
      }
    }
  }

  await db.run(`DELETE FROM conversations WHERE owner_user_id = ?`, userId);
}

async function deleteUserAccountEverywhere(db: Db, args: { userId: string; agencyId: string }) {
  await deleteConversationData(db, args.userId);

  const candidateTables = [
    "user_account_settings",
    "usage_daily",
    "notifications",
    "schedule_tasks",
    "schedule_events",
    "extractions",
    "extraction_logs",
    "bots",
    "documents",
    "uploads",
    "spreadsheet_proposals",
    "spreadsheet_audit_log",
    "spreadsheet_sheet_links",
    "outreach_campaigns",
    "outreach_leads",
    "email_accounts",
    "email_drafts",
    "members",
    "memberships",
    "agency_members",
    "invites",
    "sessions",
    "memory_store",
  ];

  for (const tableName of candidateTables) {
    await deleteRowsByUserRefs(db, tableName, args.userId, args.agencyId);
  }

  if (await tableExists(db, "users")) {
    const cols = await getTableColumns(db, "users");
    if (cols.includes("id")) {
      await db.run(`DELETE FROM users WHERE id = ?`, args.userId);
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();

    await ensureSchema(db);
    await ensureMemoryStoreSchema(db);
    await ensureAccountSettingsSchema(db);
    await ensureUsersColumns(db);

    const account = await getOrCreateAccountSettings(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
    });

    const email = await getUserEmail(db, ctx.userId);
    const memories = await loadMemories(db, {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
    });

    return Response.json({
      ok: true,
      account: {
        user_id: ctx.userId,
        agency_id: ctx.agencyId,
        email,
        display_name: account.display_name,
        timezone: account.timezone || "",
        plan: compact(ctx.plan || "free"),
        password_supported: await userHasSupportedPasswordAuth(db),
      },
      memories,
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });

    console.error("SETTINGS_ACCOUNT_MEMORY_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db = await getDb();

    await ensureSchema(db);
    await ensureMemoryStoreSchema(db);
    await ensureAccountSettingsSchema(db);
    await ensureUsersColumns(db);

    const body = (await req.json().catch(() => null)) as
      | {
          action?:
            | "save_account"
            | "save_memory"
            | "clear_memory"
            | "change_email"
            | "change_password"
            | "delete_account";
          display_name?: string;
          timezone?: string;
          memory_id?: string;
          content?: string;
          email?: string;
          current_password?: string;
          new_password?: string;
          confirm_text?: string;
        }
      | null;

    const action = compact(body?.action);

    if (action === "save_account") {
      const displayName = compact(body?.display_name).slice(0, 120);
      const timezone = compact(body?.timezone).slice(0, 120);

      await db.run(
        `INSERT INTO user_account_settings
         (user_id, agency_id, display_name, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = excluded.display_name,
           timezone = excluded.timezone,
           updated_at = excluded.updated_at`,
        ctx.userId,
        ctx.agencyId,
        displayName,
        timezone,
        nowIso(),
        nowIso()
      );

      await db.run(`UPDATE users SET display_name = ? WHERE id = ?`, displayName, ctx.userId);

      return Response.json({ ok: true });
    }

    if (action === "change_email") {
      const email = compact(body?.email).toLowerCase();
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      if (!emailOk) {
        return Response.json({ error: "Invalid email" }, { status: 400 });
      }

      const emailExists = (await db.get(
        `SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ? LIMIT 1`,
        email,
        ctx.userId
      )) as { id?: string } | undefined;

      if (emailExists?.id) {
        return Response.json({ error: "Email already in use" }, { status: 409 });
      }

      await db.run(`UPDATE users SET email = ? WHERE id = ?`, email, ctx.userId);

      return Response.json({ ok: true });
    }

    if (action === "change_password") {
      const supported = await userHasSupportedPasswordAuth(db);
      if (!supported) {
        return Response.json({ error: "Password change is not supported on this auth setup yet" }, { status: 400 });
      }

      const currentPassword = compact(body?.current_password);
      const newPassword = compact(body?.new_password);

      if (!currentPassword || !newPassword) {
        return Response.json({ error: "Missing password fields" }, { status: 400 });
      }

      if (newPassword.length < 8) {
        return Response.json({ error: "New password must be at least 8 characters" }, { status: 400 });
      }

      const storedHash = await getUserPasswordHash(db, ctx.userId);
      if (!storedHash) {
        return Response.json({ error: "No password record found for this account" }, { status: 400 });
      }

      if (!verifyPassword(currentPassword, storedHash)) {
        return Response.json({ error: "Current password is incorrect" }, { status: 400 });
      }

      const nextHash = hashPassword(newPassword);

      await db.run(
        `UPDATE users
         SET password_hash = ?
         WHERE id = ?`,
        nextHash,
        ctx.userId
      );

      return Response.json({ ok: true });
    }

    if (action === "save_memory") {
      const memoryId = compact(body?.memory_id);
      const content = String(body?.content ?? "").trim().slice(0, 12000);

      if (!memoryId) {
        return Response.json({ error: "Missing memory_id" }, { status: 400 });
      }

      const row = (await db.get(
        `SELECT id, scope, agency_id, user_id
         FROM memory_store
         WHERE id = ?
         LIMIT 1`,
        memoryId
      )) as
        | {
            id?: string;
            scope?: string;
            agency_id?: string | null;
            user_id?: string | null;
          }
        | undefined;

      if (!row?.id) {
        return Response.json({ error: "Memory not found" }, { status: 404 });
      }

      const scope = compact(row.scope);
      const agencyId = compact(row.agency_id);
      const userId = compact(row.user_id);

      const allowed =
        scope === "system"
          ? false
          : scope === "agency"
          ? agencyId === ctx.agencyId
          : scope === "user"
          ? agencyId === ctx.agencyId && userId === ctx.userId
          : false;

      if (!allowed) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      await db.run(
        `UPDATE memory_store
         SET content = ?, last_updated_at = ?, last_used_at = ?
         WHERE id = ?`,
        content,
        nowIso(),
        nowIso(),
        memoryId
      );

      return Response.json({ ok: true });
    }

    if (action === "clear_memory") {
      const memoryId = compact(body?.memory_id);

      if (!memoryId) {
        return Response.json({ error: "Missing memory_id" }, { status: 400 });
      }

      const row = (await db.get(
        `SELECT id, scope, agency_id, user_id
         FROM memory_store
         WHERE id = ?
         LIMIT 1`,
        memoryId
      )) as
        | {
            id?: string;
            scope?: string;
            agency_id?: string | null;
            user_id?: string | null;
          }
        | undefined;

      if (!row?.id) {
        return Response.json({ error: "Memory not found" }, { status: 404 });
      }

      const scope = compact(row.scope);
      const agencyId = compact(row.agency_id);
      const userId = compact(row.user_id);

      const allowed =
        scope === "system"
          ? false
          : scope === "agency"
          ? agencyId === ctx.agencyId
          : scope === "user"
          ? agencyId === ctx.agencyId && userId === ctx.userId
          : false;

      if (!allowed) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      await db.run(
        `UPDATE memory_store
         SET content = '', last_updated_at = ?, last_used_at = ?
         WHERE id = ?`,
        nowIso(),
        nowIso(),
        memoryId
      );

      return Response.json({ ok: true });
    }

    if (action === "delete_account") {
      const confirmText = compact(body?.confirm_text);
      if (confirmText !== "DELETE") {
        return Response.json({ error: "Type DELETE to confirm" }, { status: 400 });
      }

      await db.exec("BEGIN");
      try {
        await deleteUserAccountEverywhere(db, {
          userId: ctx.userId,
          agencyId: ctx.agencyId,
        });
        await db.exec("COMMIT");
      } catch (err) {
        await db.exec("ROLLBACK");
        throw err;
      }

      return jsonWithExpiredSessionCookie({ ok: true, deleted: true });
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });

    console.error("SETTINGS_ACCOUNT_MEMORY_PATCH_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}