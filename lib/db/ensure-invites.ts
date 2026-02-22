// lib/db/ensure-invites.ts
import { getDb } from "@/lib/db";

let didRun = false;

async function tableExists(db: any, name: string) {
  const row = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`, name);
  return !!row?.name;
}

async function getColumns(db: any, table: string): Promise<string[]> {
  const rows = await db.all(`PRAGMA table_info("${table}")`);
  return (rows || []).map((r: any) => String(r?.name || ""));
}

function has(cols: string[], col: string) {
  return cols.includes(col);
}

export async function ensureInviteTables() {
  if (didRun) return;
  didRun = true;

  const db = await getDb();

  // Create table if missing (new installs)
  await db.exec(`
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
  `);

  // Migrate old installs (table exists but missing columns)
  const exists = await tableExists(db, "agency_invites");
  if (exists) {
    const cols = await getColumns(db, "agency_invites");

    // Old schema in lib/schema.ts had: token (raw) and no lifecycle columns
    if (!has(cols, "email")) {
      try {
        await db.run(`ALTER TABLE agency_invites ADD COLUMN email TEXT`);
      } catch {}
    }
    if (!has(cols, "token_hash")) {
      try {
        await db.run(`ALTER TABLE agency_invites ADD COLUMN token_hash TEXT`);
      } catch {}
    }
    if (!has(cols, "expires_at")) {
      try {
        await db.run(`ALTER TABLE agency_invites ADD COLUMN expires_at TEXT`);
      } catch {}
    }
    if (!has(cols, "accepted_at")) {
      try {
        await db.run(`ALTER TABLE agency_invites ADD COLUMN accepted_at TEXT`);
      } catch {}
    }
    if (!has(cols, "revoked_at")) {
      try {
        await db.run(`ALTER TABLE agency_invites ADD COLUMN revoked_at TEXT`);
      } catch {}
    }

    // If legacy column "token" exists and token_hash is null, copy it over (best-effort).
    // This lets older invites keep working ONLY if your accept logic ever compares raw tokens.
    // Your current accept flow hashes token and compares to token_hash, so legacy invites may still be invalid.
    // But this prevents SQL errors and keeps the table consistent.
    const cols2 = await getColumns(db, "agency_invites");
    if (has(cols2, "token") && has(cols2, "token_hash")) {
      try {
        await db.run(`UPDATE agency_invites SET token_hash = COALESCE(token_hash, token)`);
      } catch {}
    }

    // Backfill required NOT NULL-ish fields for safety (keeps queries from breaking)
    // If expires_at is missing/blank on legacy rows, set far-future so they show as pending until cleaned up.
    try {
      await db.run(
        `UPDATE agency_invites
         SET expires_at = COALESCE(NULLIF(expires_at, ''), '2999-12-31T00:00:00.000Z')
         WHERE expires_at IS NULL OR expires_at = ''`
      );
    } catch {}

    // Ensure indexes
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agency_invites_agency ON agency_invites(agency_id);
      CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites(email);
      CREATE INDEX IF NOT EXISTS idx_agency_invites_token ON agency_invites(token_hash);
    `);
  }

  // Best-effort legacy drift repair for invite flow user fields
  try {
    await db.run("ALTER TABLE users ADD COLUMN role TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN status TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN password_hash TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN created_at TEXT");
  } catch {}
  try {
    await db.run("ALTER TABLE users ADD COLUMN updated_at TEXT");
  } catch {}
}