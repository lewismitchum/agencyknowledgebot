// lib/email.ts
import { Resend } from "resend";

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeBaseUrl(raw: string) {
  const v = (raw || "").trim();
  if (!v) return "";
  // If someone sets "mydomain.com" without protocol, email clients often won't link it correctly.
  if (!/^https?:\/\//i.test(v)) return `https://${v}`;
  return v;
}

/**
 * Canonical base URL for links inside emails.
 * Priority:
 *  - APP_URL / NEXT_PUBLIC_APP_URL / PUBLIC_APP_URL / SITE_URL
 *  - VERCEL_URL (converted to https://)
 *  - localhost fallback
 */
export function getAppUrl() {
  const explicit =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.SITE_URL;

  const normalizedExplicit = normalizeBaseUrl(explicit || "");
  if (normalizedExplicit) return normalizedExplicit.replace(/\/$/, "");

  const vercel = (process.env.VERCEL_URL || "").trim();
  if (vercel) return normalizeBaseUrl(vercel).replace(/\/$/, "");

  return "http://localhost:3000";
}

function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const resend = getResendClient();
  if (!resend) {
    throw new Error("Missing env: RESEND_API_KEY");
  }

  const RESEND_FROM = mustGetEnv("RESEND_FROM");

  const to = (input.to || "").trim();
  const subject = (input.subject || "").trim();
  const html = String(input.html || "");

  if (!to) throw new Error("sendEmail: missing to");
  if (!subject) throw new Error("sendEmail: missing subject");

  return await resend.emails.send({
    from: RESEND_FROM,
    to: [to],
    subject,
    html,
    replyTo: input.replyTo,
  });
}

export async function sendSupportEmail(input: {
  fromEmail?: string;
  fromName?: string;
  message: string;
  pageUrl?: string;
}) {
  const resend = getResendClient();
  if (!resend) {
    throw new Error("Missing env: RESEND_API_KEY");
  }

  const RESEND_FROM = mustGetEnv("RESEND_FROM");
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

  const replyTo = fromEmail || undefined;

  return await resend.emails.send({
    from: RESEND_FROM,
    to: [SUPPORT_INBOX_EMAIL],
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