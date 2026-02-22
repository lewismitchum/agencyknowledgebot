// lib/db/ensure-invites.ts
import { getDb } from "@/lib/db";

let didRun = false;

export async function ensureInviteTables() {
  if (didRun) return;

  const db = await getDb();

  // 1) Create tables/indexes (safe + idempotent)
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

    CREATE INDEX IF NOT EXISTS idx_agency_invites_agency ON agency_invites(agency_id);
    CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites(email);
    CREATE INDEX IF NOT EXISTS idx_agency_invites_token ON agency_invites(token_hash);
  `);

  // 2) Best-effort user columns (MUST be per-statement, catch duplicates)
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
  try {
    await db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER");
  } catch {}

  didRun = true;
}