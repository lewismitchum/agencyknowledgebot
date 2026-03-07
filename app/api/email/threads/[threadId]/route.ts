// app/api/email/threads/[threadId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/authz";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getValidGmailClient } from "@/lib/email-google";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractHeader(headers: any[] | undefined, key: string) {
  const hit = headers?.find((h) => String(h?.name || "").toLowerCase() === key.toLowerCase());
  return String(hit?.value || "").trim();
}

function safeString(v: any) {
  return String(v ?? "").trim();
}

function decodeBodyData(data?: string | null) {
  const raw = safeString(data);
  if (!raw) return "";

  try {
    return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function collectTextFromParts(parts: any[] | undefined): string {
  if (!Array.isArray(parts) || !parts.length) return "";

  for (const part of parts) {
    const mime = safeString(part?.mimeType).toLowerCase();

    if (mime === "text/plain") {
      const text = decodeBodyData(part?.body?.data);
      if (text) return text;
    }
  }

  for (const part of parts) {
    const text = collectTextFromParts(part?.parts);
    if (text) return text;
  }

  for (const part of parts) {
    const mime = safeString(part?.mimeType).toLowerCase();

    if (mime === "text/html") {
      const html = decodeBodyData(part?.body?.data);
      if (html) {
        return html
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p>/gi, "\n\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/\r/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]{2,}/g, " ")
          .trim();
      }
    }
  }

  return "";
}

function getMessageBody(payload: any) {
  const direct = decodeBodyData(payload?.body?.data);
  if (direct) return direct;

  const fromParts = collectTextFromParts(payload?.parts);
  if (fromParts) return fromParts;

  return "";
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ threadId: string }> }
) {
  let where = "start";

  try {
    where = "requireActiveMember";
    const session = await requireActiveMember(req);

    where = "plan_gate";
    const db: Db = await getDb();
    await ensureSchema(db);

    const rawPlan = await getAgencyPlan(db, session.agencyId, session.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Email inbox is available on Corporation.",
          code: "upgrade_required",
          plan: planKey,
        },
        { status: 403 }
      );
    }

    where = "rate_limit";
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_thread_read",
      perMinute: 60,
      perHour: 2000,
    });

    const params = await ctx.params;
    const threadId = safeString(params?.threadId);

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "MISSING_THREAD_ID" }, { status: 400 });
    }

    where = "gmail_auth_refresh";
    const gmailRes = await getValidGmailClient({
      agencyId: session.agencyId,
      userId: session.userId,
    });

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
          where,
        },
        { status }
      );
    }

    const gmail = gmailRes.gmail;

    where = "gmail_get_thread";
    const tr = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });

    const messagesRaw = Array.isArray(tr.data.messages) ? tr.data.messages : [];

    const messages = messagesRaw.map((m: any) => {
      const payload = m?.payload || {};
      const headers = payload?.headers || [];

      const from = extractHeader(headers, "From");
      const to = extractHeader(headers, "To");
      const date = extractHeader(headers, "Date");
      const subject = extractHeader(headers, "Subject");
      const snippet = safeString(m?.snippet || "");
      const body = getMessageBody(payload);

      return {
        id: safeString(m?.id),
        from,
        to,
        date,
        subject,
        snippet,
        body: body || snippet,
      };
    });

    const cleaned = messages.filter((m) => m.id);
    const threadSubject =
      cleaned[cleaned.length - 1]?.subject || cleaned[0]?.subject || "";

    await db.run(`UPDATE users SET connected_gmail = 1 WHERE id = ?`, session.userId).catch(() => {});

    return NextResponse.json({
      ok: true,
      thread: {
        id: threadId,
        subject: threadSubject,
        messages: cleaned,
      },
      email: gmailRes.email ?? null,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json(
        { ok: false, error: msg, code: "rate_limited", where: "rate_limit" },
        { status: 429 }
      );
    }

    console.error("EMAIL_THREAD_DETAIL_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "internal", where, details: sanitizeError(err) },
      { status: 500 }
    );
  }
}