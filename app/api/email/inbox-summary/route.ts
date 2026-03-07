// app/api/email/inbox-summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/authz";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getValidGmailClient } from "@/lib/email-google";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractHeader(headers: any[] | undefined, key: string) {
  const hit = headers?.find((h) => String(h?.name || "").toLowerCase() === key.toLowerCase());
  return String(hit?.value || "").trim();
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sanitizeError(err: any) {
  const message = String(err?.message || "");
  const name = String(err?.name || "");
  const code = (err?.code ?? err?.response?.data?.error?.status ?? err?.response?.status ?? undefined) as any;

  const googleReason =
    err?.response?.data?.error?.errors?.[0]?.reason ??
    err?.response?.data?.error?.status ??
    err?.errors?.[0]?.reason ??
    undefined;

  const status = (err?.response?.status ?? undefined) as any;

  return {
    name: name || undefined,
    message: message || undefined,
    code: code || undefined,
    status: status || undefined,
    googleReason: googleReason || undefined,
  };
}

function parseJsonObject(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {}

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }

  return null;
}

export async function POST(req: NextRequest) {
  let where = "start";

  try {
    where = "requireActiveMember";
    const session = await requireActiveMember(req);

    where = "db";
    const db: Db = await getDb();
    await ensureSchema(db);

    where = "plan_gate";
    const rawPlan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: "Email inbox is available on Corporation.", code: "upgrade_required", plan: planKey },
        { status: 403 }
      );
    }

    where = "rate_limit";
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_inbox_summary",
      perMinute: 10,
      perHour: 200,
    });

    where = "body";
    const body = (await req.json().catch(() => ({}))) as { bot_id?: string; max?: number; q?: string };
    const botId = safeString(body?.bot_id);
    const max = Math.min(20, Math.max(5, safeInt(body?.max, 12)));
    const q = safeString(body?.q);

    if (!botId) {
      return NextResponse.json({ ok: false, error: "MISSING_BOT_ID" }, { status: 400 });
    }

    where = "bot";
    const bot = (await db.get(
      `
      SELECT id, name, vector_store_id
      FROM bots
      WHERE id = ?
        AND agency_id = ?
        AND (owner_user_id IS NULL OR owner_user_id = ?)
      LIMIT 1
      `,
      botId,
      session.agencyId,
      session.userId
    )) as { id?: string; name?: string | null; vector_store_id?: string | null } | undefined;

    if (!bot?.id) {
      return NextResponse.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    }

    if (!bot.vector_store_id) {
      return NextResponse.json(
        { ok: false, error: "This bot is missing a vector store. Repair it in Bots first.", code: "BOT_VECTOR_STORE_MISSING" },
        { status: 409 }
      );
    }

    where = "gmail_auth";
    const gmailRes = await getValidGmailClient({ agencyId: session.agencyId, userId: session.userId });

    if (!gmailRes.ok) {
      const code =
        gmailRes.error === "NOT_CONNECTED"
          ? "not_connected"
          : gmailRes.error === "MISSING_TOKENS" || gmailRes.error === "MISSING_REFRESH_TOKEN"
            ? "missing_tokens"
            : gmailRes.error === "MISSING_GOOGLE_OAUTH_ENV"
              ? "missing_google_env"
              : "gmail_auth_error";

      const status = gmailRes.error === "NOT_CONNECTED" || gmailRes.error === "MISSING_TOKENS" ? 409 : 500;

      return NextResponse.json(
        {
          ok: false,
          error:
            gmailRes.error === "NOT_CONNECTED"
              ? "Not connected. Click Connect Gmail."
              : gmailRes.error === "MISSING_TOKENS" || gmailRes.error === "MISSING_REFRESH_TOKEN"
                ? "Gmail tokens missing. Reconnect Gmail."
                : "Gmail auth error.",
          code,
        },
        { status }
      );
    }

    const gmail = gmailRes.gmail;

    where = "gmail_list";
    const listRes = await gmail.users.threads.list({
      userId: "me",
      maxResults: max,
      q: q || undefined,
    });

    const threadIds = (listRes.data.threads || [])
      .map((t: any) => String(t?.id || "").trim())
      .filter(Boolean)
      .slice(0, max);

    if (!threadIds.length) {
      return NextResponse.json({
        ok: true,
        summary: "Your inbox looks clear right now.",
        urgent: [],
        follow_ups: [],
        priorities: [],
        threads_analyzed: 0,
        email: gmailRes.email ?? null,
      });
    }

    where = "gmail_get_threads";
    const threadSummaries = await Promise.all(
      threadIds.map(async (id: string) => {
        try {
          const tr = await gmail.users.threads.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });

          const msgs = tr.data.messages || [];
          const last = msgs[msgs.length - 1];
          const headers = last?.payload?.headers || [];

          return {
            id,
            from: extractHeader(headers, "From"),
            subject: extractHeader(headers, "Subject"),
            date: extractHeader(headers, "Date"),
            snippet: safeString(tr.data.snippet || last?.snippet || ""),
            message_count: msgs.length,
          };
        } catch {
          return {
            id,
            from: "",
            subject: "",
            date: "",
            snippet: "",
            message_count: 0,
          };
        }
      })
    );

    const usableThreads = threadSummaries.filter(
      (t) => t.id && (t.subject || t.snippet || t.from)
    );

    if (!usableThreads.length) {
      return NextResponse.json({
        ok: true,
        summary: "Your inbox looks clear right now.",
        urgent: [],
        follow_ups: [],
        priorities: [],
        threads_analyzed: 0,
        email: gmailRes.email ?? null,
      });
    }

    const inboxContext = usableThreads
      .map((t, i) => {
        return [
          `Thread ${i + 1}`,
          `ID: ${t.id}`,
          `From: ${t.from || "(unknown)"}`,
          `Subject: ${t.subject || "(no subject)"}`,
          `Date: ${t.date || "(unknown date)"}`,
          `Messages: ${t.message_count}`,
          `Snippet: ${t.snippet || "(no snippet)"}`,
        ].join("\n");
      })
      .join("\n\n---\n\n");

    where = "openai_summary";
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      tools: [{ type: "file_search", vector_store_ids: [String(bot.vector_store_id)] }],
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are Louis.Ai. Summarize a Gmail inbox for an agency user. Use the inbox thread data as primary evidence. You may also use file_search against the selected bot docs for tone, priorities, and business context, but do not invent facts not supported by inbox data or docs. Return strict JSON only with keys: summary, urgent, follow_ups, priorities. summary must be a string. urgent/follow_ups/priorities must each be arrays of short strings. Keep arrays concise, max 5 items each.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Selected bot: ${String(bot.name || "Bot")}

Mailbox: ${gmailRes.email ?? "unknown"}
Search filter: ${q || "(none)"}

Inbox threads:
${inboxContext}`,
            },
          ],
        },
      ],
    });

    const outputText = String(resp.output_text || "").trim();
    const parsed = parseJsonObject(outputText) as
      | {
          summary?: unknown;
          urgent?: unknown;
          follow_ups?: unknown;
          priorities?: unknown;
        }
      | null;

    const summary =
      typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Here is a quick overview of your recent inbox activity.";

    const urgent = Array.isArray(parsed?.urgent)
      ? parsed!.urgent.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
      : [];

    const followUps = Array.isArray(parsed?.follow_ups)
      ? parsed!.follow_ups.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
      : [];

    const priorities = Array.isArray(parsed?.priorities)
      ? parsed!.priorities.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
      : [];

    await db.run(`UPDATE users SET connected_gmail = 1 WHERE id = ?`, session.userId).catch(() => {});

    return NextResponse.json({
      ok: true,
      summary,
      urgent,
      follow_ups: followUps,
      priorities,
      threads_analyzed: usableThreads.length,
      email: gmailRes.email ?? null,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json({ ok: false, error: msg, code: "rate_limited", where: "rate_limit" }, { status: 429 });
    }

    console.error("EMAIL_INBOX_SUMMARY_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "internal", where, details: sanitizeError(err) },
      { status: 500 }
    );
  }
}