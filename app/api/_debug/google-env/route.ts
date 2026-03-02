// app/api/_debug/google-env/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
  const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  const hasRedirect = !!process.env.GOOGLE_REDIRECT_URI;

  // Helpful non-secret metadata
  const nodeEnv = process.env.NODE_ENV || null;
  const vercelEnv = process.env.VERCEL_ENV || null;
  const vercelUrl = process.env.VERCEL_URL || null;

  return NextResponse.json({
    ok: true,
    env: {
      NODE_ENV: nodeEnv,
      VERCEL_ENV: vercelEnv,
      VERCEL_URL: vercelUrl,
    },
    google: {
      GOOGLE_CLIENT_ID: hasClientId,
      GOOGLE_CLIENT_SECRET: hasClientSecret,
      GOOGLE_REDIRECT_URI: hasRedirect,
      // show only length (still safe)
      GOOGLE_REDIRECT_URI_len: (process.env.GOOGLE_REDIRECT_URI || "").length,
    },
  });
}