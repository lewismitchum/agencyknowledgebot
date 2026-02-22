// app/api/accept-invite/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const res = await fetch(new URL("/api/auth/accept-invite", req.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
        // forward Set-Cookie so session gets written
        "set-cookie": res.headers.get("set-cookie") || "",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Server error", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}