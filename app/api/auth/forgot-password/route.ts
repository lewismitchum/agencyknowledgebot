import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  makeToken,
  hashToken,
  isoFromNowMinutes,
  nowIso,
  minutesSince,
} from "@/lib/tokens";
import { getAppUrl, sendEmail } from "@/lib/email";
import { ensureSchema } from "@/lib/schema";

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return { email: j?.email };
  }

  const text = await req.text().catch(() => "");
  const params = new URLSearchParams(text);
  return { email: params.get("email") };
}

export async function POST(req: NextRequest) {
  const { email } = await readBody(req);

  // Always return OK to prevent user enumeration
  const okResponse = NextResponse.json({ ok: true });

  if (!email?.trim()) return okResponse;

  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const agency = await db.get(
    `SELECT id, email, password_reset_last_sent_at
     FROM agencies
     WHERE email = ?`,
    normalizedEmail
  );

  if (!agency) return okResponse;

  // Throttle: max 1 email per 2 minutes
  if (agency.password_reset_last_sent_at) {
    const mins = minutesSince(agency.password_reset_last_sent_at);
    if (mins < 2) return okResponse;
  }

  const token = makeToken();
  const tokenHash = hashToken(token);
  const expiresAt = isoFromNowMinutes(30);

  await db.run(
    `UPDATE agencies
     SET password_reset_token_hash = ?,
         password_reset_expires_at = ?,
         password_reset_last_sent_at = ?
     WHERE id = ?`,
    tokenHash,
    expiresAt,
    nowIso(),
    agency.id
  );

  const resetUrl = `${getAppUrl()}/reset-password?token=${token}`;

  // 🔧 DEV HELP: log link so you can click it without SMTP
  if (process.env.NODE_ENV !== "production") {
    console.log("DEV reset link:", resetUrl);
  }

  try {
    await sendEmail({
      to: normalizedEmail,
      subject: "Reset your Louis.Ai password",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5">
          <h2>Password reset</h2>
          <p>Click the button below to reset your password.</p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}" style="background:#111;color:#fff;padding:10px 14px;border-radius:999px;text-decoration:none;display:inline-block;">
              Reset password
            </a>
          </p>
          <p style="color:#666;font-size:12px;">This link expires in 30 minutes.</p>
        </div>
      `,
    });
  } catch (e) {
    console.error("Forgot password email failed:", e);

    // In dev, surface the error so you can fix SMTP
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json(
        { error: "Email sending failed. Check SMTP env vars and server logs." },
        { status: 500 }
      );
    }
  }

  return okResponse;
}
