import { NextRequest, NextResponse } from "next/server";


export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.cookies.get("louis_session")?.value || null;
  const session = getSessionFromRequest(req);

  return NextResponse.json({
    hasCookie: Boolean(raw),
    cookieLooksLikeJwt: raw ? raw.split(".").length === 3 : false,
    session: session ?? null,
  });
}
