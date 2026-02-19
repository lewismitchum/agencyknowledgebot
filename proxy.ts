// proxy.ts
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "louis_session";

// Page routes that require login
const PROTECTED_PAGE_PREFIXES = ["/app/chat", "/admin", "/launch"];

// API routes that require login
const PROTECTED_API_PREFIXES = ["/api/chat", "/api/upload", "/api/me"];

function isProtectedPage(pathname: string) {
  return PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function applySecurityHeaders(res: NextResponse) {
  // ✅ Next.js App Router requires inline scripts for hydration/streaming in many setups.
  // Tighten later using nonces/hashes once everything is stable.
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    // Allow Next inline scripts for now; otherwise /signup, /login can break.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval'",
    "script-src-attr 'self' 'unsafe-inline'",
    // Include any external origins you actually call from the browser.
    // Add Turso host if you ever call it client-side (usually you don't).
    "connect-src 'self' https://api.openai.com wss:",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  return res;
}

// ✅ Next.js 16 proxy entrypoint
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ Always allow public + auth routes
  if (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/check-email") ||
    pathname.startsWith("/api/auth")
  ) {
    const res = NextResponse.next();
    return applySecurityHeaders(res);
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;

  // 🔒 Protect API routes
  if (isProtectedApi(pathname)) {
    if (!session) {
      const res = NextResponse.json({ user: null, error: "Unauthorized" }, { status: 401 });
      return applySecurityHeaders(res);
    }
    const res = NextResponse.next();
    return applySecurityHeaders(res);
  }

  // 🔒 Protect page routes
  if (isProtectedPage(pathname)) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      const res = NextResponse.redirect(url);
      return applySecurityHeaders(res);
    }
    const res = NextResponse.next();
    return applySecurityHeaders(res);
  }

  const res = NextResponse.next();
  return applySecurityHeaders(res);
}

// Only run proxy where needed
export const config = {
  matcher: ["/app/chat/:path*", "/admin/:path*", "/launch", "/api/:path*"],
};
