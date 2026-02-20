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
  // NOTE:
  // - Turnstile script loads from challenges.cloudflare.com
  // - Turnstile renders a widget using iframes from challenges.cloudflare.com
  // - Keep Next hydration working (needs 'unsafe-inline'; sometimes 'unsafe-eval' in dev)
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",

    // Scripts
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
    "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
    "script-src-attr 'self' 'unsafe-inline'",

    // Turnstile uses iframes
    "frame-src 'self' https://challenges.cloudflare.com",

    // Network calls (add your own endpoints as needed)
    "connect-src 'self' https://api.openai.com https://challenges.cloudflare.com wss:",
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

  // Always allow public + auth routes (but still apply headers)
  if (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/support") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/check-email") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/support")
  ) {
    return applySecurityHeaders(NextResponse.next());
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;

  // Protect API routes
  if (isProtectedApi(pathname)) {
    if (!session) {
      return applySecurityHeaders(
        NextResponse.json({ user: null, error: "Unauthorized" }, { status: 401 })
      );
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // Protect page routes
  if (isProtectedPage(pathname)) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return applySecurityHeaders(NextResponse.redirect(url));
    }
    return applySecurityHeaders(NextResponse.next());
  }

  return applySecurityHeaders(NextResponse.next());
}

// ✅ Run proxy on all routes so CSP applies to /signup /login /support too.
// Exclude Next static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};