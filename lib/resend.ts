// lib/resend.ts
type SendEmailArgs = {
  to: string;
  from: string;
  subject: string;
  html: string;
  reply_to?: string;
};

export async function resendSendEmail(args: SendEmailArgs) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY_MISSING");

  const res = await fetchJson("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      reply_to: args.reply_to,
    }),
  });

  const text = await res.text();
  const json = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();

  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || text || "Resend error";
    throw new Error(`RESEND_SEND_FAILED: ${res.status} ${msg}`);
  }

  return json;
}