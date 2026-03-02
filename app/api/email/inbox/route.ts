// app/api/email/inbox/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { decrypt, encrypt } from "@/lib/crypto";

export const runtime = "nodejs";

function looksEncryptedToken(s: string) {
  const parts = String(s || "").split(".");
  return parts.length === 3 && parts.every((p) => p && p.length >= 8);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    if (session.plan !== "corporation") {
      return NextResponse.json(
        {
          ok: false,
          plan: session.plan,
          upsell: { code: "upgrade_required", message: "Email inbox is available on Corporation." },
        },
        { status: 403 },
      );
    }

    const db = await getDb();

    // Drift-safe email_accounts table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        agency_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        email TEXT,
        access_token TEXT,
        refresh_token TEXT,
        expiry_date INTEGER,
        scope TEXT,
        token_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_email_accounts_agency_user
        ON email_accounts(agency_id, user_id);
    `);

    const account = await db.get(
      `SELECT provider, email, access_token, refresh_token, expiry_date
       FROM email_accounts
       WHERE user_id = ? AND agency_id = ?`,
      [session.userId, session.agencyId],
    );

    if (!account) {
      return NextResponse.json({
        ok: true,
        plan: session.plan,
        connected: false,
        provider: null,
        email: null,
        message: "Click Connect Gmail to enable inbox.",
      });
    }

    // If tokens are still plaintext (legacy), encrypt once here.
    const accessStored = String(account.access_token || "");
    const refreshStored = String(account.refresh_token || "");

    let migrated = false;
    const updates: any[] = [];
    const sets: string[] = [];

    if (accessStored && !looksEncryptedToken(accessStored)) {
      sets.push("access_token = ?");
      updates.push(encrypt(accessStored));
      migrated = true;
    }

    if (refreshStored && !looksEncryptedToken(refreshStored)) {
      sets.push("refresh_token = ?");
      updates.push(encrypt(refreshStored));
      migrated = true;
    }

    if (migrated) {
      sets.push("updated_at = ?");
      updates.push(Date.now());
      updates.push(session.userId, session.agencyId);

      await db.run(
        `UPDATE email_accounts
         SET ${sets.join(", ")}
         WHERE user_id = ? AND agency_id = ?`,
        updates,
      );
    }

    // Determine “connected” (has any usable token)
    const access = decrypt(accessStored) || "";
    const refresh = decrypt(refreshStored) || "";
    const connected = Boolean(access || refresh);

    return NextResponse.json({
      ok: true,
      plan: session.plan,
      connected,
      provider: String(account.provider || "gmail"),
      email: account.email ? String(account.email) : null,
      message: connected ? "Connected." : "Tokens missing. Reconnect Gmail.",
    });
  } catch (err: any) {
    console.error("Email inbox status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}