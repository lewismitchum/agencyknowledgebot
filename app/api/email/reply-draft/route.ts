import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";
import { google } from "googleapis";

export const runtime = "nodejs";

function safeStr(x: any) {
  return String(x ?? "").trim();
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
  const mime = safeStr(payload?.mimeType);

  if (mime.toLowerCase().startsWith("text/plain") && direct) return direct;

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

function extractHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  key: string
) {
  if (!headers) return "";
  const hit = headers.find((h) => (h.name || "").toLowerCase() === key.toLowerCase());
  return (hit?.value || "").trim();
}

function tryParseJsonObject(s: string): any | null {
  const t = safeStr(s);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    // sometimes models wrap in ```json ... ```
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

export async function POST(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    // Corp only
    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
    }

    const body = await req.json();
    const threadId = safeStr(body?.threadId);
    const botId = safeStr(body?.botId);
    const instruction = safeStr(body?.instruction);

    if (!threadId || !botId) {
      return NextResponse.json({ error: "Missing threadId or botId" }, { status: 400 });
    }

    const db = await getDb();

    const bot = await db.get(
      `SELECT id, vector_store_id FROM bots
       WHERE id = ? AND agency_id = ?`,
      [botId, session.agencyId]
    );

    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    if (!bot.vector_store_id) {
      return NextResponse.json({ error: "Bot missing vector store" }, { status: 409 });
    }

    const account = await db.get(
      `SELECT access_token, refresh_token, expiry_date
       FROM email_accounts
       WHERE user_id = ? AND agency_id = ?`,
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

    const sys = `
You are Louis.Ai.

Hard rules:
- Use agency docs (file_search) for internal business facts: pricing, timelines, SOPs, deliverables, policies, meeting times, commitments, contract terms, client-specific status.
- If the user instruction or the thread requires internal facts AND file_search provides no supporting evidence, you MUST return fallback=true.
- If the reply can be written using only the email thread context + general writing, you may draft without docs.
- Never invent internal facts. Never guess numbers, dates, commitments, or policy language without doc evidence.
- Output JSON ONLY.

Output schema (exact keys):
{
  "fallback": boolean,
  "message": string,        // required if fallback=true (use: "I couldn’t find this in your agency documents.")
  "draftBody": string       // required if fallback=false
}
`.trim();

    const user = `
Thread context:
${threadContext}

User instruction:
${instruction || "(none) — draft the best professional reply."}

Write a reply email. Keep it concise and aligned with the thread tone.
Return JSON only.
`.trim();

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      tools: [
        {
          type: "file_search",
          vector_store_ids: [bot.vector_store_id],
        },
      ],
      input: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    const raw = safeStr(resp.output_text);
    const parsed = tryParseJsonObject(raw);

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
    if (!draftBody) {
      return NextResponse.json({ error: "Empty draftBody" }, { status: 500 });
    }

    const draftId = crypto.randomUUID();

    await db.run(
      `INSERT INTO email_drafts
       (id, agency_id, user_id, thread_id, bot_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [draftId, session.agencyId, session.userId, threadId, botId, draftBody, Date.now()]
    );

    return NextResponse.json({ draftId, draftBody });
  } catch (err: any) {
    console.error("Reply draft error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}