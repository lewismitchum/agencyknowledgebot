// app/api/email/thread/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/authz";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getValidGmailClient } from "@/lib/email-google";

export const runtime = "nodejs";

function safeString(v: any) {
  return String(v ?? "").trim();
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

function extractHeader(headers: any[] | undefined, key: string) {
  const hit = headers?.find((h) => String(h?.name || "").toLowerCase() === key.toLowerCase());
  return safeString(hit?.value || "");
}

function b64UrlDecodeToUtf8(data: string) {
  try {
    const s = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const base64 = s + pad;
    return Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function walkPartsForBodies(part: any, out: { text: string; html: string }) {
  if (!part) return;

  const mime = safeString(part.mimeType || "");
  const bodyData = safeString(part?.body?.data || "");

  if (bodyData) {
    const decoded = b64UrlDecodeToUtf8(bodyData);

    if (mime === "text/plain") {
      if (!out.text) out.text = decoded;
    } else if (mime === "text/html") {
      if (!out.html) out.html = decoded;
    }
  }

  const parts = Array.isArray(part.parts) ? part.parts : [];
  for (const p of parts) walkPartsForBodies(p, out);
}

function pickPreview(text: string, maxLen = 240) {
  const t = safeString(text).replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen).trim() + "…" : t;
}

export async function GET(req: NextRequest) {
  let where = "start";

  try {
    where = "requireActiveMember";
    const session = await requireActiveMember(req);

    // Corp only
    if (session.plan !== "corporation") {
      return NextResponse.json(
        { ok: false, error: "Email inbox is available on Corporation.", code: "upgrade_required" },
        { status: 403 },
      );
    }

    where = "rate_limit";
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_thread",
      perMinute: 60,
      perHour: 3000,
    });

    const url = new URL(req.url);
    const id = safeString(url.searchParams.get("id") || "");
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing thread id", code: "missing_id" }, { status: 400 });
    }

    where = "gmail_auth_refresh";
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
          where,
          details: gmailRes,
        },
        { status },
      );
    }

    const gmail = gmailRes.gmail;

    where = "gmail_thread_get";
    const tr = await gmail.users.threads.get({
      userId: "me",
      id,
      format: "full",
    });

    const messages = (tr?.data?.messages || []).map((m: any) => {
      const headers = m?.payload?.headers || [];
      const subject = extractHeader(headers, "Subject");
      const from = extractHeader(headers, "From");
      const to = extractHeader(headers, "To");
      const cc = extractHeader(headers, "Cc");
      const date = extractHeader(headers, "Date");
      const messageId = safeString(extractHeader(headers, "Message-Id") || extractHeader(headers, "Message-ID"));
      const snippet = safeString(m?.snippet || tr?.data?.snippet || "");

      const bodies = { text: "", html: "" };
      walkPartsForBodies(m?.payload, bodies);

      const text = safeString(bodies.text);
      const html = safeString(bodies.html);

      return {
        id: safeString(m?.id || ""),
        thread_id: safeString(m?.threadId || id),
        internal_date: safeString(m?.internalDate || ""),
        headers: { subject, from, to, cc, date, message_id: messageId },
        snippet,
        preview: pickPreview(text || snippet),
        body: {
          text: text || null,
          html: html || null,
        },
      };
    });

    return NextResponse.json({
      ok: true,
      email: gmailRes.email ?? null,
      thread: {
        id: safeString(tr?.data?.id || id),
        history_id: safeString(tr?.data?.historyId || ""),
        snippet: safeString(tr?.data?.snippet || ""),
        messages,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json({ ok: false, error: msg, code: "rate_limited", where: "rate_limit" }, { status: 429 });
    }

    console.error("Email thread error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "internal", where, details: sanitizeError(err) },
      { status: 500 },
    );
  }
}