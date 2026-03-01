// app/api/health/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function has(v?: string | null) {
  return Boolean(v && String(v).trim().length > 0);
}

function setOrMissing(v?: string | null) {
  return has(v) ? "set" : "missing";
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "UNAUTHORIZED" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(req: NextRequest) {
  // 🔒 Lock down in production with a shared secret.
  // Set HEALTHCHECK_SECRET in Vercel (Production + Preview).
  const secret = (process.env.HEALTHCHECK_SECRET || "").trim();

  if (process.env.NODE_ENV === "production") {
    // If you forgot to set the secret, do NOT expose anything.
    if (!secret) return unauthorized();

    const url = new URL(req.url);
    const provided = (url.searchParams.get("secret") || "").trim();

    if (!provided || provided !== secret) return unauthorized();
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // Core app/env
  checks.NODE_ENV = { ok: true, detail: String(process.env.NODE_ENV || "unknown") };

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.VERCEL_URL;

  checks.APP_URL = {
    ok: has(appUrl),
    detail: has(appUrl) ? String(appUrl) : "missing (set NEXT_PUBLIC_APP_URL or APP_URL)",
  };

  // Auth/session
  checks.JWT_SECRET = {
    ok: has(process.env.JWT_SECRET),
    detail: setOrMissing(process.env.JWT_SECRET),
  };

  // Turnstile (login/signup)
  checks.TURNSTILE_SITE_KEY = {
    ok: has(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    detail: setOrMissing(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  };
  checks.TURNSTILE_SECRET_KEY = {
    ok: has(process.env.TURNSTILE_SECRET_KEY),
    detail: setOrMissing(process.env.TURNSTILE_SECRET_KEY),
  };

  // OpenAI
  checks.OPENAI_API_KEY = {
    ok: has(process.env.OPENAI_API_KEY),
    detail: setOrMissing(process.env.OPENAI_API_KEY),
  };

  // Email (Resend)
  checks.RESEND_API_KEY = {
    ok: has(process.env.RESEND_API_KEY),
    detail: setOrMissing(process.env.RESEND_API_KEY),
  };
  checks.RESEND_FROM = {
    ok: has(process.env.RESEND_FROM),
    detail: has(process.env.RESEND_FROM) ? String(process.env.RESEND_FROM) : "missing",
  };
  checks.SUPPORT_INBOX_EMAIL = {
    ok: has(process.env.SUPPORT_INBOX_EMAIL),
    detail: has(process.env.SUPPORT_INBOX_EMAIL) ? String(process.env.SUPPORT_INBOX_EMAIL) : "missing",
  };

  // Stripe (if billing is enabled)
  checks.STRIPE_SECRET_KEY = {
    ok: has(process.env.STRIPE_SECRET_KEY),
    detail: setOrMissing(process.env.STRIPE_SECRET_KEY),
  };
  checks.STRIPE_WEBHOOK_SECRET = {
    ok: has(process.env.STRIPE_WEBHOOK_SECRET),
    detail: setOrMissing(process.env.STRIPE_WEBHOOK_SECRET),
  };

  // Turso
  const tursoUrlOk = has(process.env.TURSO_DATABASE_URL);
  const tursoTokenOk = has(process.env.TURSO_AUTH_TOKEN);

  checks.TURSO_DATABASE_URL = {
    ok: tursoUrlOk,
    detail: setOrMissing(process.env.TURSO_DATABASE_URL),
  };
  checks.TURSO_AUTH_TOKEN = {
    ok: tursoTokenOk,
    detail: setOrMissing(process.env.TURSO_AUTH_TOKEN),
  };

  // DB connectivity (only attempt if Turso env looks present)
  if (tursoUrlOk && tursoTokenOk) {
    try {
      const db = await getDb();
      const row = await db.get<{ one: number }>("SELECT 1 as one");
      checks.DB = {
        ok: row?.one === 1,
        detail: row?.one === 1 ? "connected" : "unexpected response",
      };
    } catch (e: any) {
      checks.DB = { ok: false, detail: e?.message || "db error" };
    }
  } else {
    checks.DB = {
      ok: false,
      detail: "skipped (missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN)",
    };
  }

  // Decide what is REQUIRED for “ok”
  const requiredKeys = [
    "APP_URL",
    "JWT_SECRET",
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "OPENAI_API_KEY",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "DB",
  ] as const;

  const ok = requiredKeys.every((k) => checks[k]?.ok);

  return NextResponse.json(
    { ok, checks },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}