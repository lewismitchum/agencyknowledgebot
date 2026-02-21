// lib/email.ts
import { Resend } from "resend";

function env(name: string) {
  return (process.env[name] || "").trim();
}

function mustGetEnv(name: string) {
  const v = env(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const resend = new Resend(mustGetEnv("RESEND_API_KEY"));

export function getAppUrl() {
  // Prefer explicit URL
  const explicit =
    env("APP_URL") ||
    env("NEXT_PUBLIC_APP_URL") ||
    env("PUBLIC_APP_URL") ||
    env("SITE_URL");

  if (explicit) return explicit.replace(/\/+$/, "");

  // Vercel provides VERCEL_URL without protocol
  const vercelUrl = env("VERCEL_URL");
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;

  // Local fallback
  return "http://localhost:3000";
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const RESEND_FROM = mustGetEnv("RESEND_FROM");

  return await resend.emails.send({
    from: RESEND_FROM,
    to: [input.to],
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