// app/api/support/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendSupportEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const fromEmail = typeof body?.email === "string" ? body.email : "";
    const fromName = typeof body?.name === "string" ? body.name : "";
    const message = typeof body?.message === "string" ? body.message : "";
    const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl : "";

    if (!message.trim()) {
      return NextResponse.json(
        { ok: false, error: "Message is required" },
        { status: 400 }
      );
    }

    await sendSupportEmail({
      fromEmail,
      fromName,
      message,
      pageUrl,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Support email failed:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "Failed to send support request" },
      { status: 500 }
    );
  }
}