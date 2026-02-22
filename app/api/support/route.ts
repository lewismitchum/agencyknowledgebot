// app/api/support/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { sendSupportEmail } from "@/lib/email";

export const runtime = "nodejs";

function nowIso() {
  return new Date().toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const db: Db = await getDb();
    await ensureSchema(db);

    const body = await req.json().catch(() => null);

    const fromEmail = typeof body?.email === "string" ? body.email.trim() : "";
    const fromName = typeof body?.name === "string" ? body.name.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl.trim() : "";

    if (!message) {
      return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
    }

    // Always store the ticket (email can fail; we still keep the request)
    const idRow = (await db.get(
      `SELECT lower(hex(randomblob(16))) AS id`
    )) as { id: string } | undefined;

    const ticketId = idRow?.id || Math.random().toString(16).slice(2);
    const createdAt = nowIso();

    await db.run(
      `INSERT INTO support_tickets (id, created_at, from_email, from_name, message, page_url, email_sent, email_error)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
      ticketId,
      createdAt,
      fromEmail || null,
      fromName || null,
      message,
      pageUrl || null
    );

    // Best-effort email (do not fail the ticket)
    let emailSent = false;
    let emailError: string | null = null;

    try {
      await sendSupportEmail({
        fromEmail,
        fromName,
        message,
        pageUrl,
      });
      emailSent = true;
    } catch (e: any) {
      emailSent = false;
      emailError = String(e?.message ?? e ?? "Email failed");
      console.error("Support email failed:", emailError);
    }

    await db.run(
      `UPDATE support_tickets
       SET email_sent = ?, email_error = ?
       WHERE id = ?`,
      emailSent ? 1 : 0,
      emailError,
      ticketId
    );

    return NextResponse.json({ ok: true, id: ticketId, email_sent: emailSent });
  } catch (err: any) {
    console.error("Support request failed:", err?.message || err);
    return NextResponse.json({ ok: false, error: "Failed to submit support request" }, { status: 500 });
  }
}