// lib/email.ts
import { Resend } from "resend";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

function getEnv(name: string) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}

function mustGetEnv(name: string) {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ✅ Used by signup/resend/invites
export function getAppUrl() {
  const explicit =
    getEnv("APP_URL") ||
    getEnv("NEXT_PUBLIC_APP_URL") ||
    getEnv("NEXT_PUBLIC_SITE_URL") ||
    null;

  if (explicit) return explicit.replace(/\/+$/, "");

  // Vercel provides this at runtime in many contexts
  const vercelUrl = getEnv("VERCEL_URL");
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "")}`.replace(/\/+$/, "");

  return "http://localhost:3000";
}

function getResendClient() {
  const key = mustGetEnv("RESEND_API_KEY");
  return new Resend(key);
}

// ✅ Generic email sender expected by existing routes
export async function sendEmail(input: SendEmailInput) {
  const RESEND_FROM = mustGetEnv("RESEND_FROM");

  const to = String(input.to || "").trim();
  const subject = String(input.subject || "").trim();
  const html = String(input.html || "").trim();
  const replyTo = input.replyTo ? String(input.replyTo).trim() : undefined;

  if (!to) throw new Error("Missing to");
  if (!subject) throw new Error("Missing subject");
  if (!html) throw new Error("Missing html");

  const resend = getResendClient();

  const result = await resend.emails.send({
    from: RESEND_FROM,
    to: [to],
    subject,
    html,
    replyTo,
  });

  return result;
}

// ✅ Your support sender (still used by /api/support)
export async function sendSupportEmail(input: {
  fromEmail?: string;
  fromName?: string;
  message: string;
  pageUrl?: string;
}) {
  const SUPPORT_INBOX_EMAIL = mustGetEnv("SUPPORT_INBOX_EMAIL");

  const fromEmail = (input.fromEmail || "").trim();
  const fromName = (input.fromName || "").trim();
  const message = (input.message || "").trim();
  const pageUrl = (input.pageUrl || "").trim();

  const subject = fromEmail ? `Support request from ${fromEmail}` : "Support request";

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

  // Use replyTo so you can respond directly from your inbox.
  const replyTo = fromEmail || undefined;

  return sendEmail({
    to: SUPPORT_INBOX_EMAIL,
    subject,
    html,
    replyTo,
  });
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}