// app/api/support/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeStr(v: any, max = 4000) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function newId() {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureSupportSchema(db: any) {
  // Create table first
  await db.exec(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      agency_id TEXT,
      user_id TEXT,
      name TEXT,
      email TEXT,
      message TEXT NOT NULL,
      page_url TEXT,
      user_agent TEXT,
      ip TEXT,
      email_sent INTEGER NOT NULL DEFAULT 0,
      email_error TEXT
    );
  `);

  // Drift-safe indexes
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_support_tickets_agency_id ON support_tickets(agency_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);`);
}

async function sendSupportEmail(args: { to: string; subject: string; text: string; replyTo?: string }) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false as const, skipped: true as const, error: "RESEND_API_KEY not set" };

  const from = process.env.SUPPORT_FROM?.trim() || "Louis.Ai Support <support@letsalterminds.org>";

  const payload: any = {
    from,
    to: [args.to],
    subject: args.subject,
    text: args.text,
  };
  if (args.replyTo) payload.reply_to = args.replyTo;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) {
    return { ok: false as const, skipped: false as const, error: `Resend error (${r.status}): ${t || r.statusText}` };
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    // session optional (support page works for logged out too)
    let session: any = null;
    try {
      session = await (getSessionFromRequest as any)(req);
    } catch {
      session = null;
    }

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const name = safeStr(body?.name, 200);
    const email = safeStr(body?.email, 320);
    const message = safeStr(body?.message, 8000);
    const pageUrl = safeStr(body?.pageUrl, 2000);

    if (!message) return json({ ok: false, error: "Message is required" }, 400);

    const ua = safeStr(req.headers.get("user-agent"), 800);
    const ip =
      safeStr(req.headers.get("x-forwarded-for"), 200) ||
      safeStr(req.headers.get("x-real-ip"), 200);

    const ticketId = newId();

    const db = await getDb();
    await ensureSupportSchema(db);

    await db.run(
      `
        INSERT INTO support_tickets (
          id, agency_id, user_id, name, email, message, page_url, user_agent, ip, email_sent, email_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
      `,
      [
        ticketId,
        session?.agencyId ?? null,
        session?.userId ?? null,
        name || null,
        email || null,
        message,
        pageUrl || null,
        ua || null,
        ip || null,
      ],
    );

    const to = process.env.SUPPORT_TO?.trim() || "support@letsalterminds.org";
    const replyTo = email && email.includes("@") ? email : undefined;

    const subject = `Louis.Ai Support: ${ticketId}`;
    const text = [
      `Ticket: ${ticketId}`,
      session?.agencyId ? `Agency: ${session.agencyId}` : "",
      session?.userId ? `User: ${session.userId}` : "",
      name ? `Name: ${name}` : "",
      email ? `Email: ${email}` : "",
      pageUrl ? `Page: ${pageUrl}` : "",
      ip ? `IP: ${ip}` : "",
      ua ? `UA: ${ua}` : "",
      "",
      "Message:",
      message,
    ]
      .filter(Boolean)
      .join("\n");

    let emailSent = false;
    let emailErr: string | null = null;

    try {
      const r = await sendSupportEmail({ to, subject, text, replyTo });
      if (r.ok) emailSent = true;
      else if (!r.skipped) emailErr = r.error || "Email delivery failed";
    } catch (e: any) {
      emailErr = String(e?.message ?? e ?? "Email delivery failed");
    }

    if (emailSent || emailErr) {
      await db.run(`UPDATE support_tickets SET email_sent = ?, email_error = ? WHERE id = ?`, [
        emailSent ? 1 : 0,
        emailErr,
        ticketId,
      ]);
    }

    return json({ ok: true, ticket_id: ticketId, email_sent: emailSent });
  } catch (e: any) {
    console.error("SUPPORT_API_ERROR", e);
    // Return the real error string so you can fix immediately
    return json({ ok: false, error: String(e?.message ?? e ?? "Server error") }, 500);
  }
}