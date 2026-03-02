// app/api/auth/resend-verify/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { makeToken, hashToken, isoFromNowMinutes, nowIso } from "@/lib/tokens";
import { getAppUrl, sendEmail } from "@/lib/email";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

async function readBody(req: NextRequest): Promise<{ email?: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return { email: j?.email };
  }
  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return { email: params.get("email") || undefined };
}

export async function POST(req: NextRequest) {
  try {
    if (!resendConfigured()) {
      return NextResponse.json({ ok: false, error: "EMAIL_NOT_CONFIGURED" }, { status: 400 });
    }

    const { email } = await readBody(req);

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      return NextResponse.json({ ok: false, error: "MISSING_EMAIL" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    // ✅ Rate limit: 3 / 10 minutes per IP + email combo
    try {
      await enforceRateLimit({
        userId: `ip:${ip}:${normalizedEmail}`,
        agencyId: "public",
        key: "resend_verify",
        perMinute: 1, // 1/min
        perHour: 18,  // effectively ~3 per 10 mins + buffer
      });
    } catch {
      return NextResponse.json(
        { ok: false, error: "RATE_LIMITED", message: "Too many requests. Try again in a few minutes." },
        { status: 429 }
      );
    }

    const db: Db = await getDb();
    await ensureSchema(db);

    // Only for agencies that exist and are NOT verified yet
    const agency = (await db.get(
      `SELECT id, email_verified
       FROM agencies
       WHERE lower(email) = ?
       LIMIT 1`,
      normalizedEmail
    )) as { id: string; email_verified: number | null } | undefined;

    // Always return ok to avoid account enumeration
    if (!agency?.id) {
      return NextResponse.json({ ok: true });
    }

    const verified = Number(agency.email_verified ?? 0) === 1;
    if (verified) {
      return NextResponse.json({ ok: true });
    }

    const token = makeToken();
    const tokenHash = hashToken(token);
    const expiresAt = isoFromNowMinutes(60);

    await db.run(
      `UPDATE agencies
       SET email_verify_token_hash = ?,
           email_verify_expires_at = ?,
           email_verify_last_sent_at = ?
       WHERE id = ?`,
      tokenHash,
      expiresAt,
      nowIso(),
      agency.id
    );

    const verifyUrl = `${getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;

    try {
      await sendEmail({
        to: normalizedEmail,
        subject: "Verify your email for Louis.Ai",
        html: `
          <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5">
            <h2>Verify your email</h2>
            <p>Click the button below to verify your email and activate your workspace.</p>
            <p style="margin: 24px 0;">
              <a href="${verifyUrl}" style="background:#111;color:#fff;padding:10px 14px;border-radius:999px;text-decoration:none;display:inline-block;">
                Verify email
              </a>
            </p>
            <p style="color:#666;font-size:12px;">This link expires in 60 minutes.</p>
          </div>
        `,
      });
    } catch (e) {
      console.error("RESEND_VERIFY_EMAIL_SEND_FAILED", e);
      // Still return ok (user can try again later; we rate limit anyway)
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("RESEND_VERIFY_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}