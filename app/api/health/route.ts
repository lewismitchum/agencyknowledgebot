// app/api/health/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function has(v?: string | null) {
  return Boolean(v && String(v).trim().length > 0);
}

function mask(v?: string | null) {
  if (!v) return "missing";
  const s = String(v);
  if (s.length <= 8) return "set";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function isAllowed(req: NextRequest) {
  // Allow in non-prod always
  if (process.env.NODE_ENV !== "production") return true;

  // In prod: require a shared secret
  const secret = process.env.HEALTHCHECK_SECRET;
  if (!secret) return false;

  const got =
    req.headers.get("x-health-secret") ||
    new URL(req.url).searchParams.get("secret") ||
    "";

  return got === secret;
}

export async function GET(req: NextRequest) {
  if (!isAllowed(req)) {
    // Don’t reveal what’s missing
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.OPENAI_API_KEY = {
    ok: has(process.env.OPENAI_API_KEY),
    detail: has(process.env.OPENAI_API_KEY) ? "set" : "missing",
  };

  // Prefer NEXT_PUBLIC_APP_URL / APP_URL etc, but don’t print the full value in prod
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || null;
  checks.APP_URL = {
    ok: has(appUrl),
    detail: process.env.NODE_ENV === "production" ? (has(appUrl) ? "set" : "missing") : String(appUrl || "missing"),
  };

  checks.TURSO_DATABASE_URL = {
    ok: has(process.env.TURSO_DATABASE_URL),
    detail:
      process.env.NODE_ENV === "production"
        ? (has(process.env.TURSO_DATABASE_URL) ? "set" : "missing")
        : mask(process.env.TURSO_DATABASE_URL || null),
  };

  checks.TURSO_AUTH_TOKEN = {
    ok: has(process.env.TURSO_AUTH_TOKEN),
    detail: process.env.NODE_ENV === "production" ? (has(process.env.TURSO_AUTH_TOKEN) ? "set" : "missing") : "set/missing",
  };

  // Resend (your code uses RESEND_* now)
  checks.RESEND = {
    ok: has(process.env.RESEND_API_KEY) && has(process.env.RESEND_FROM),
    detail: has(process.env.RESEND_API_KEY) && has(process.env.RESEND_FROM) ? "configured" : "missing RESEND_API_KEY/RESEND_FROM",
  };

  // DB connectivity
  try {
    const db = await getDb();
    const row = await db.get<{ one: number }>("SELECT 1 as one");
    checks.DB = { ok: row?.one === 1, detail: row?.one === 1 ? "connected" : "unexpected response" };
  } catch (e: any) {
    checks.DB = { ok: false, detail: e?.message || "db error" };
  }

  const ok = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({
    ok,
    checks,
    env: process.env.NODE_ENV,
  });
}