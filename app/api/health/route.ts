import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function has(v?: string | null) {
  return Boolean(v && String(v).trim().length > 0);
}

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // Required for production
  checks.OPENAI_API_KEY = {
    ok: has(process.env.OPENAI_API_KEY),
    detail: has(process.env.OPENAI_API_KEY) ? "set" : "missing",
  };

  // Needed for email verification / forgot password in production
  checks.APP_URL = {
    ok: has(process.env.APP_URL),
    detail: has(process.env.APP_URL) ? String(process.env.APP_URL) : "missing",
  };

  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  const smtpOk = smtpKeys.every((k) => has(process.env[k]));
  checks.SMTP = {
    ok: smtpOk,
    detail: smtpOk ? "configured" : "missing one or more SMTP_* vars",
  };

  // DB connectivity
  try {
    const db = await getDb();
    const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='agencies'");
    checks.SQLITE = { ok: Boolean(row), detail: row ? "connected" : "agencies table missing" };
  } catch (e: any) {
    checks.SQLITE = { ok: false, detail: e?.message || "db error" };
  }

  // Vercel note (SQLite persistence)
  checks.VERCEL_SQLITE_NOTE = {
    ok: true,
    detail:
      "If deploying to Vercel, SQLite file storage is not durable across instances. Use a hosted DB (e.g., Postgres/Turso) for production.",
  };

  const ok = Object.values(checks).every((c) => c.ok || c === checks.VERCEL_SQLITE_NOTE);

  return NextResponse.json({
    ok,
    checks,
    env: process.env.NODE_ENV,
  });
}
