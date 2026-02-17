// app/api/debug/session/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.cookies.get("louis_session")?.value || null;

  let session: any = null;
  try {
    if (raw) {
      try {
        session = JSON.parse(raw);
      } catch {
        // not JSON, return raw string
        session = raw;
      }
    } else {
      session = null;
    }
  } catch (e: any) {
    session = { error: String(e?.message ?? e) };
  }

  return NextResponse.json({
    hasCookie: Boolean(raw),
    cookieLength: raw ? raw.length : 0,
    session,
  });
}
