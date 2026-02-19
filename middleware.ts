// middleware.ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(_req: NextRequest) {
  const res = NextResponse.next();

  // ✅ Relaxed CSP for Next.js App Router (allows required inline scripts).
  // Tighten later with nonces/hashes once everything is stable.
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    // Next.js needs inline scripts for hydration/streaming. Allow for now.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval'",
    "script-src-attr 'self' 'unsafe-inline'",
    // Add any external services you actually use:
    "connect-src 'self' https://api.openai.com https://*.turso.io wss:",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);

  // Optional hardening headers (safe to keep)
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");

  return res;
}

// Don’t run middleware on static assets
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
