// lib/email.ts
import { Resend } from "resend";

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const resend = new Resend(mustGetEnv("RESEND_API_KEY"));

/* =========================================================
   Core Helpers (used by auth + invites)
========================================================= */

export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const RESEND_FROM = mustGetEnv("RESEND_FROM");

  return resend.emails.send({
    from: RESEND_FROM,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
  });
}

/* =========================================================
   Support Email (public form)
========================================================= */

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

  return resend.emails.send({
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