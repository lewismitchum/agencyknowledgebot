import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { openai } from "@/lib/openai";
import { google } from "googleapis";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await requireActiveMember(req);

    // Corp only
    if (session.plan !== "corporation") {
      return NextResponse.json({ error: "Upgrade required." }, { status: 403 });
    }

    const { threadId, botId, instruction } = await req.json();

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
    const recentMessages = messages.slice(-5);

    const threadContext = recentMessages
      .map((m) => {
        const headers = m.payload?.headers || [];
        const from = headers.find((h) => h.name === "From")?.value || "Unknown";
        const subject = headers.find((h) => h.name === "Subject")?.value || "";

        const bodyData =
          m.payload?.parts?.find((p) => p.mimeType === "text/plain")?.body?.data ||
          m.payload?.body?.data ||
          "";

        // NOTE: Gmail API uses base64url in many places, but this is "good enough" for our draft context.
        // We keep it simple; thread endpoints do the full base64url decode.
        const decoded = bodyData ? Buffer.from(String(bodyData), "base64").toString("utf-8") : "";

        return `From: ${from}\nSubject: ${subject}\n\n${decoded}`;
      })
      .join("\n\n---\n\n");

    const systemPrompt = `
You are Louis.Ai.

Rules:
- Prioritize agency documents when relevant.
- If clearly internal business knowledge AND no document evidence exists, respond:
  "I couldn’t find this in your agency documents."
- Match tone of thread.
- Be concise and professional.
- No hallucinated internal policy.
`.trim();

    const userPrompt = `
Thread:

${threadContext}

Instruction:
${instruction || "Write a professional reply."}

Draft the reply only.
`.trim();

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      tools: [
        {
          type: "file_search",
          vector_store_ids: [bot.vector_store_id],
        },
      ],
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    // ✅ Correct, type-safe: output_text is the unified text output
    const draftBody = String(response.output_text || "").trim();

    if (!draftBody) {
      return NextResponse.json({ error: "Failed to generate draft" }, { status: 500 });
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