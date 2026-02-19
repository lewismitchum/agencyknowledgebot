// app/api/health/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function has(v?: string | null) {
  return Boolean(v && String(v).trim().length > 0);
}

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // Required for production
  checks.OPENAI_API_KEY = {
    ok: has(process.env.OPENAI_API_KEY),
    detail: has(process.env.OPENAI_API_KEY) ? "set" : "missing",
  };

  checks.APP_URL = {
    ok: has(process.env.APP_URL),
    detail: has(process.env.APP_URL) ? String(process.env.APP_URL) : "missing",
  };

  // Turso env vars (production DB)
  checks.TURSO_DATABASE_URL = {
    ok: has(process.env.TURSO_DATABASE_URL),
    detail: has(process.env.TURSO_DATABASE_URL) ? "set" : "missing",
  };

  checks.TURSO_AUTH_TOKEN = {
    ok: has(process.env.TURSO_AUTH_TOKEN),
    detail: has(process.env.TURSO_AUTH_TOKEN) ? "set" : "missing",
  };

  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  const smtpOk = smtpKeys.every((k) => has(process.env[k]));
  checks.SMTP = {
    ok: smtpOk,
    detail: smtpOk ? "configured" : "missing one or more SMTP_* vars",
  };

  // DB connectivity (Turso via @libsql/client)
  try {
    const db = await getDb();
    // Cheap query that works on libsql and verifies connectivity.
    const row = await db.get<{ one: number }>("SELECT 1 as one");
    checks.DB = { ok: row?.one === 1, detail: row?.one === 1 ? "connected" : "unexpected response" };
  } catch (e: any) {
    checks.DB = { ok: false, detail: e?.message || "db error" };
  }

  // Note: If DB vars are missing, Vercel serverless instances have no durable local sqlite.
  checks.VERCEL_DB_NOTE = {
    ok: true,
    detail:
      "Production requires a hosted DB. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel (Production) and redeploy.",
  };

  const ok = Object.values(checks).every((c) => c.ok || c === checks.VERCEL_DB_NOTE);

  return NextResponse.json({
    ok,
    checks,
    env: process.env.NODE_ENV,
  });
}
