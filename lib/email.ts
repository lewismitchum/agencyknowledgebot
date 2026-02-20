// lib/email.ts
import { Resend } from "resend";

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const resend = new Resend(mustGetEnv("RESEND_API_KEY"));

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

  // Use replyTo so you can respond directly from your inbox.
  const replyTo = fromEmail || undefined;

  const result = await resend.emails.send({
    from: RESEND_FROM,
    to: [SUPPORT_INBOX_EMAIL],
    subject,
    html,
    replyTo,
  });

  return result;
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}