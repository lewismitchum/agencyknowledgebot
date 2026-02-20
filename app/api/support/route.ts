import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";

export const runtime = "nodejs";

function json(res: any, status = 200) {
  return NextResponse.json(res, { status });
}

function getClientIp(req: NextRequest) {
  const xf = req.headers.get("x-forwarded-for") || "";
  if (xf) return xf.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip") || "";
  if (xr) return xr.trim();
  return "unknown";
}

async function verifyTurnstile(token: string, ip?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!secret) return { ok: false, reason: "Turnstile misconfigured." };

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j: any = await r.json().catch(() => null);
  if (!j || !j.success) return { ok: false, reason: "Captcha verification failed." };
  return { ok: true };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const email = String(body?.email || "").trim();
    const message = String(body?.message || "").trim();
    const token = String(body?.turnstile_token || "").trim();

    if (!email || !message || !token) {
      return json({ error: "Missing fields." }, 400);
    }

    if (message.length < 5) return json({ error: "Message too short." }, 400);
    if (message.length > 5000) return json({ error: "Message too long." }, 400);

    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent") || "";

    const v = await verifyTurnstile(token, ip);
    if (!v.ok) return json({ error: v.reason }, 400);

    const db: Db = await getDb();
    await ensureSchema(db);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        ip TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        user_agent TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_support_messages_ip_created_at
      ON support_messages (ip, created_at);
    `);

    const now = Date.now();
    const since = now - 24 * 60 * 60 * 1000;

    const row = await db.get(
      `SELECT COUNT(*) AS c FROM support_messages WHERE ip = ? AND created_at >= ?`,
      ip,
      since
    );

    const count = Number((row as any)?.c ?? 0);
    if (count >= 5) {
      return json({ error: "Too many requests. Try again later." }, 429);
    }

    await db.run(
      `INSERT INTO support_messages (created_at, ip, email, message, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      now,
      ip,
      email,
      message,
      ua
    );

    const resendKey = process.env.RESEND_API_KEY || "";
    const to = process.env.SUPPORT_TO_EMAIL || "";
    const from = process.env.SUPPORT_FROM_EMAIL || "onboarding@resend.dev";

    if (!resendKey) return json({ error: "Email service misconfigured." }, 500);
    if (!to) return json({ error: "Support email not configured." }, 500);

    const resend = new Resend(resendKey);

    const text = [
      "New Louis.Ai Support Message",
      "",
      `From: ${email}`,
      `IP: ${ip}`,
      `User-Agent: ${ua}`,
      "",
      "Message:",
      message,
      "",
      `Timestamp: ${new Date(now).toISOString()}`,
    ].join("\n");

    await resend.emails.send({
      from,
      to,
      subject: `Louis.Ai Support — ${email}`,
      text,
    });

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}