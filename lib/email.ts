// lib/email.ts
import { Resend } from "resend";

function cleanUrl(u: string) {
  return u.replace(/\/+$/, "");
}

export function getAppUrl() {
  // Prefer an explicit URL you control
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL;

  if (explicit) return cleanUrl(explicit);

  // Vercel provides VERCEL_URL without protocol
  const vercel = process.env.VERCEL_URL;
  if (vercel) return cleanUrl(`https://${vercel}`);

  // Local fallback
  return "http://localhost:3000";
}

let resend: Resend | null = null;
function getResend() {
  if (resend) return resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Missing env: RESEND_API_KEY");
  resend = new Resend(key);
  return resend;
}

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const RESEND_FROM = mustGetEnv("RESEND_FROM");

  const to = String(input.to || "").trim();
  if (!to) throw new Error("sendEmail: missing to");

  return await getResend().emails.send({
    from: RESEND_FROM,
    to: [to],
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
  });
}

export async function sendSupportEmail(input: {
  fromEmail?: string;
  fromName?: string;
  message: string;
  pageUrl?: string;
}) {
  const RESEND_FROM = mustGetEnv("RESEND_FROM");
  const SUPPORT_INBOX_EMAIL = mustGetEnv("SUPPORT_INBOX_EMAIL");

  const fromEmail = (input.fromEmail || "").trim();
  const fromName = (input.fromName || "").trim();
  const message = (input.message || "").trim();
  const pageUrl = (input.pageUrl || "").trim();

  const subject = fromEmail
    ? `Support request from ${fromEmail}`
    : "Support request";

  const safeFromLine = fromEmail
    ? `${fromName ? fromName + " " : ""}<${fromEmail}>`
    : "Anonymous";

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
      <h2>New Support Request</h2>
      <p><strong>From:</strong> ${escapeHtml(safeFromLine)}</p>
      ${pageUrl ? `<p><strong>Page:</strong> ${escapeHtml(pageUrl)}</p>` : ""}
      <hr />
      <pre style="white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(
        message
      )}</pre>
    </div>
  `;

  const replyTo = fromEmail || undefined;

  return await getResend().emails.send({
    from: RESEND_FROM,
    to: [SUPPORT_INBOX_EMAIL],
    subject,
    html,
    replyTo,
  });
}

/**
 * Welcome email (throws on missing env, consistent with sendEmail/sendSupportEmail).
 * Use sendWelcomeEmailSafe inside auth flows to avoid breaking signup/login.
 */
export async function sendWelcomeEmail(input: {
  to: string;
  agencyName?: string | null;
}) {
  const to = String(input.to || "").trim();
  if (!to) throw new Error("sendWelcomeEmail: missing to");

  const agencyName = String(input.agencyName || "your agency").trim();
  const appUrl = getAppUrl();

  const subject = "Welcome to Louis.Ai";

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">Welcome to Louis.Ai</h2>

      <p style="margin: 0 0 10px;">
        You're set up for <strong>${escapeHtml(agencyName)}</strong>.
      </p>

      <p style="margin: 0 0 16px;">
        Start here:
        <a href="${appUrl}/app" style="color: #111; font-weight: 600;">Open Louis.Ai</a>
      </p>

      <div style="border: 1px solid #eee; border-radius: 12px; padding: 14px; background: #fafafa;">
        <div style="font-weight: 600; margin-bottom: 8px;">Fast path:</div>
        <ol style="margin: 0; padding-left: 18px;">
          <li>Pick your bot</li>
          <li>Upload a document</li>
          <li>Click <strong>Extract</strong> to generate schedule + tasks</li>
        </ol>
      </div>

      <p style="margin: 16px 0 0; font-size: 12px; color: #666;">
        If you didn't request this, you can ignore this email.
      </p>
    </div>
  `;

  return await sendEmail({ to, subject, html });
}

/**
 * Fire-and-forget wrapper. Never throws. Never blocks auth.
 */
export async function sendWelcomeEmailSafe(input: {
  to: string;
  agencyName?: string | null;
}) {
  try {
    await sendWelcomeEmail(input);
    return { ok: true as const };
  } catch (err) {
    console.warn("WELCOME_EMAIL_FAILED", err);
    return { ok: false as const };
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}