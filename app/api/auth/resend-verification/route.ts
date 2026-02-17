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

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));

  // Always return OK (avoid user enumeration)
  const ok = NextResponse.json({ ok: true });

  if (!email?.trim()) return ok;

  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const agency = await db.get(
    `SELECT id, email, email_verified, email_verify_last_sent_at
     FROM agencies
     WHERE email = ?`,
    normalizedEmail
  );

  if (!agency) return ok;
  if (agency.email_verified === 1) return ok;

  // throttle: 1 email per 2 minutes
  if (agency.email_verify_last_sent_at) {
    const mins = minutesSince(agency.email_verify_last_sent_at);
    if (mins < 2) return ok;
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

  const verifyUrl = `${getAppUrl()}/verify-email?token=${token}`;

  // Dev helper: click link from terminal
  if (process.env.NODE_ENV !== "production") {
    console.log("DEV verify link:", verifyUrl);
  }

  try {
    await sendEmail({
      to: normalizedEmail,
      subject: "Verify your email for Louis.Ai",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5">
          <h2>Verify your email</h2>
          <p>Click the button below to verify your email.</p>
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
    console.error("Resend verification failed:", e);

    // In dev, show the failure
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json(
        { error: "Email sending failed. Check SMTP env vars and server logs." },
        { status: 500 }
      );
    }
  }

  return ok;
}
