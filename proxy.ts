import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "louis_session";

// Page routes that require login
const PROTECTED_PAGE_PREFIXES = ["/app/chat", "/admin", "/launch"];

// API routes that require login
const PROTECTED_API_PREFIXES = ["/api/chat", "/api/upload", "/api/me"];

function isProtectedPage(pathname: string) {
  return PROTECTED_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
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
    return NextResponse.next();
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;

  // 🔒 Protect API routes
  if (isProtectedApi(pathname)) {
    if (!session) {
      return NextResponse.json(
        { user: null, error: "Unauthorized" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // 🔒 Protect page routes
  if (isProtectedPage(pathname)) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

// Only run proxy where needed
export const config = {
  matcher: ["/app/chat/:path*", "/admin/:path*", "/launch", "/api/:path*"],
};
