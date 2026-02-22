// lib/db/ensure-invites.ts
import { getDb } from "@/lib/db";

function qIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(db: any, tableName: string) {
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    tableName
  );
  return !!row?.name;
}

async function getTableColumns(db: any, tableName: string): Promise<string[]> {
  const rows = (await db.all(`PRAGMA table_info(${qIdent(tableName)})`)) as Array<{ name: string }>;
  return (rows ?? []).map((r) => r.name);
}

function has(cols: string[], col: string) {
  return cols.includes(col);
}

async function rebuildAgencyInvites(db: any) {
  // Invites are ephemeral -> safest migration is rebuild.
  await db.exec(`
    DROP TABLE IF EXISTS agency_invites;

    CREATE TABLE IF NOT EXISTS agency_invites (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agency_invites_agency ON agency_invites(agency_id);
    CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites(email);
    CREATE INDEX IF NOT EXISTS idx_agency_invites_token ON agency_invites(token_hash);
  `);
}

export async function ensureInviteTables() {
  const db = await getDb();

  const exists = await tableExists(db, "agency_invites");

  if (!exists) {
    await rebuildAgencyInvites(db);
  } else {
    const cols = await getTableColumns(db, "agency_invites");

    // Legacy table usually has `token` (NOT NULL) instead of `token_hash`/`expires_at`.
    const isLegacy =
      has(cols, "token") ||
      !has(cols, "token_hash") ||
      !has(cols, "expires_at") ||
      !has(cols, "accepted_at") ||
      !has(cols, "revoked_at");

    if (isLegacy) {
      await rebuildAgencyInvites(db);
    } else {
      // Ensure indexes exist
      await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agency_invites_agency ON agency_invites(agency_id);
        CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites(email);
        CREATE INDEX IF NOT EXISTS idx_agency_invites_token ON agency_invites(token_hash);
      `);
    }
  }

  // Best-effort user columns (safe per-statement)
  try { await db.run("ALTER TABLE users ADD COLUMN role TEXT"); } catch {}
  try { await db.run("ALTER TABLE users ADD COLUMN status TEXT"); } catch {}
  try { await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT"); } catch {}
  try { await db.run("ALTER TABLE users ADD COLUMN created_at TEXT"); } catch {}
  try { await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT"); } catch {}
  try { await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER"); } catch {}
}