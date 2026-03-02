// app/api/email/reply-draft/route.ts
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function extractHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  key: string
) {
  if (!headers) return "";
  const hit = headers.find((h) => (h.name || "").toLowerCase() === key.toLowerCase());
  return (hit?.value || "").trim();
}

function b64urlToUtf8(data: string) {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(padLen);
  return Buffer.from(padded, "base64").toString("utf8");
}

function pickPlainText(payload: any): string {
  if (!payload) return "";

  const direct = payload?.body?.data ? b64urlToUtf8(String(payload.body.data)) : "";
  const mime = safeStr(payload?.mimeType).toLowerCase();

  if (mime.startsWith("text/plain") && direct) return direct;

  const parts: any[] = Array.isArray(payload?.parts) ? payload.parts : [];
  if (parts.length === 0) return direct || "";

  for (const p of parts) {
    const pm = safeStr(p?.mimeType).toLowerCase();
    if (pm.startsWith("text/plain") && p?.body?.data) {
      return b64urlToUtf8(String(p.body.data));
    }
  }

  for (const p of parts) {
    const pm = safeStr(p?.mimeType).toLowerCase();
    if (pm.startsWith("multipart/")) {
      const nested = pickPlainText(p);
      if (nested) return nested;
    }
  }

  return "";
}

function tryParseJsonObject(s: string): any | null {
  const t = safeStr(s);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/```json\s*([\s\S]*?)\s*```/i) || t.match(/```\s*([\s\S]*?)\s*```/i);
    if (m?.[1]) {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function ensureEmailDraftsColumns(db: Db) {
  // Drift-safe: older envs might miss columns
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_drafts (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bot_id TEXT,
      thread_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_drafts_user_created
      ON email_drafts(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_drafts_agency_created
      ON email_drafts(agency_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_drafts_thread
      ON email_drafts(thread_id);
  `);

  // If table existed but missing columns, add them
  await db.run("ALTER TABLE email_drafts ADD COLUMN bot_id TEXT").catch(() => {});
  await db.run("ALTER TABLE email_drafts ADD COLUMN thread_id TEXT").catch(() => {});
  await db.run("ALTER TABLE email_drafts ADD COLUMN subject TEXT").catch(() => {});
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    // Corp only
    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
    }

    // Rate limit AI drafting
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_reply",
      perMinute: 10,
      perHour: 200,
    });

    const body = await req.json().catch(() => ({}));
    const threadId = safeStr(body?.threadId);
    const botId = safeStr(body?.botId);
    const instruction = safeStr(body?.instruction);

    if (!threadId || !botId) {
      return NextResponse.json({ error: "Missing threadId or botId" }, { status: 400 });
    }

    const db = await getDb();
    await ensureEmailDraftsColumns(db);

    const bot = await db.get(
      `SELECT id, vector_store_id
       FROM bots
       WHERE id = ? AND agency_id = ?
       LIMIT 1`,
      [botId, session.agencyId]
    );

    if (!bot?.id) return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    if (!bot.vector_store_id) return NextResponse.json({ error: "Bot missing vector store" }, { status: 409 });

    const account = await db.get(
      `SELECT access_token, refresh_token, expiry_date
       FROM email_accounts
       WHERE user_id = ? AND agency_id = ?
       LIMIT 1`,
      [session.userId, session.agencyId]
    );

    if (!account) {
      return NextResponse.json({ error: "No Gmail account connected" }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: account.expiry_date,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const threadRes = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });

    const messages = threadRes.data.messages || [];
    const recent = messages.slice(-6);

    const threadContext = recent
      .map((m) => {
        const headers = m?.payload?.headers || [];
        const from = extractHeader(headers, "From") || "Unknown";
        const to = extractHeader(headers, "To") || "";
        const date = extractHeader(headers, "Date") || "";
        const subject = extractHeader(headers, "Subject") || "";
        const text = pickPlainText(m?.payload);
        const snippet = safeStr(m?.snippet || "");
        const bodyText = safeStr(text) || (snippet ? `[snippet]\n${snippet}` : "");
        return `From: ${from}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\n\n${bodyText}`;
      })
      .join("\n\n---\n\n");

    const lastHeaders = messages[messages.length - 1]?.payload?.headers || [];
    const threadSubject = safeStr(extractHeader(lastHeaders, "Subject")) || "Re:";

    const sys = `
You are Louis.Ai.

Hard rules:
- Use agency docs (file_search) for internal business facts: pricing, timelines, SOPs, deliverables, policies, meeting times, commitments, contract terms, client-specific status.
- If the instruction or thread requires internal facts AND file_search provides no supporting evidence, return fallback=true.
- If reply can be written using only email thread context + general writing, you may draft without docs.
- Never invent internal facts or commitments.
- Output JSON ONLY.

Schema:
{
  "fallback": boolean,
  "message": string,
  "draftSubject": string,
  "draftBody": string
}
`.trim();

    const user = `
Thread context:
${threadContext}

User instruction:
${instruction || "(none) — draft the best professional reply."}

Return JSON only.
`.trim();

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      tools: [{ type: "file_search", vector_store_ids: [bot.vector_store_id] }],
      input: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const parsed = tryParseJsonObject(resp.output_text || "");

    if (!parsed || typeof parsed.fallback !== "boolean") {
      return NextResponse.json({ error: "Invalid model output" }, { status: 500 });
    }

    if (parsed.fallback) {
      return NextResponse.json({
        fallback: true,
        message: safeStr(parsed.message) || "I couldn’t find this in your agency documents.",
      });
    }

    const draftBody = safeStr(parsed.draftBody);
    const draftSubject = safeStr(parsed.draftSubject) || threadSubject;

    if (!draftBody) return NextResponse.json({ error: "Empty draftBody" }, { status: 500 });

    const draftId = crypto.randomUUID();

    await db.run(
      `INSERT INTO email_drafts
       (id, agency_id, user_id, bot_id, thread_id, subject, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [draftId, session.agencyId, session.userId, botId, threadId, draftSubject, draftBody, Date.now()]
    );

    return NextResponse.json({
      ok: true,
      draft: {
        id: draftId,
        thread_id: threadId,
        bot_id: botId,
        subject: draftSubject,
        body: draftBody,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json({ error: msg }, { status: 429 });
    }
    console.error("EMAIL_REPLY_DRAFT_ERROR", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}