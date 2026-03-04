// app/api/email/threads/route.ts
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

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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

export async function GET(req: NextRequest) {
  let where: string = "start";

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
        { ok: false, error: "Email inbox is available on Corporation.", code: "upgrade_required", plan: planKey },
        { status: 403 },
      );
    }

    where = "rate_limit";
    await enforceRateLimit({
      userId: session.userId,
      agencyId: session.agencyId,
      key: "email_threads",
      perMinute: 30,
      perHour: 1500,
    });

    const url = new URL(req.url);
    const max = Math.min(50, Math.max(1, safeInt(url.searchParams.get("max"), 30)));
    const q = safeString(url.searchParams.get("q") || "");

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
        },
        { status },
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
      .filter(Boolean);

    where = "gmail_get_threads";
    const threads = await Promise.all(
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

          const subject = extractHeader(headers, "Subject");
          const from = extractHeader(headers, "From");
          const date = extractHeader(headers, "Date");
          const snippet = safeString(tr.data.snippet || last?.snippet || "");

          return { id, subject, from, date, snippet };
        } catch {
          return { id, subject: "", from: "", date: "", snippet: "" };
        }
      }),
    );

    return NextResponse.json({
      ok: true,
      plan: planKey,
      email: gmailRes.email ?? null,
      threads: threads.filter((t) => t.id),
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Too many requests") || msg.includes("Hourly limit")) {
      return NextResponse.json({ ok: false, error: msg, code: "rate_limited", where: "rate_limit" }, { status: 429 });
    }

    console.error("Email threads error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "internal", where, details: sanitizeError(err) },
      { status: 500 },
    );
  }
}