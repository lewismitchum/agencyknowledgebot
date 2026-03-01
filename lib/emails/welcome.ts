// lib/emails/welcome.ts
import { resendSendEmail } from "@/lib/resend";

type WelcomeArgs = {
  to: string;
  userName?: string | null;
  agencyName?: string | null;
};

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendWelcomeEmail(args: WelcomeArgs) {
  const from = String(process.env.RESEND_FROM || "").trim();
  if (!from) throw new Error("RESEND_FROM_MISSING");

  const baseUrl = String(process.env.APP_BASE_URL || "").trim() || "https://letsalterminds.org";

  const name = args.userName ? escapeHtml(String(args.userName)) : "there";
  const agency = args.agencyName ? escapeHtml(String(args.agencyName)) : "your workspace";

  const subject = `Welcome to Louis.Ai — get value in 3 minutes`;

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.5; color:#111;">
    <h2 style="margin:0 0 12px;">Welcome, ${name} 👋</h2>
    <p style="margin:0 0 12px;">
      Your Louis.Ai workspace for <b>${agency}</b> is ready.
    </p>

    <div style="margin:16px 0; padding:14px; border:1px solid #e5e7eb; border-radius:12px; background:#fafafa;">
      <h3 style="margin:0 0 10px; font-size:14px;">Get value in 3 minutes:</h3>
      <ol style="margin:0; padding-left:18px; font-size:14px;">
        <li>Upload one SOP / onboarding doc</li>
        <li>Ask a question in Chat (Louis answers docs-first)</li>
        <li>(Paid) Extract tasks + events into Schedule</li>
      </ol>
    </div>

    <p style="margin:0 0 10px;">
      Quick links:
      <a href="${baseUrl}/app/docs">Docs</a> •
      <a href="${baseUrl}/app/chat">Chat</a> •
      <a href="${baseUrl}/app/bots">Bots</a> •
      <a href="${baseUrl}/app/billing">Billing</a>
    </p>

    <p style="margin:14px 0 0; font-size:12px; color:#6b7280;">
      If you run into anything, just reply to this email.
    </p>
  </div>
  `.trim();

  return resendSendEmail({
    to: args.to,
    from,
    subject,
    html,
    reply_to: from,
  });
}