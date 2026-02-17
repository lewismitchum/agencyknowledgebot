import nodemailer from "nodemailer";

export function getAppUrl() {
  // Prefer APP_URL, fall back to localhost in dev
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !pass || !from) return null;

  return {
    host,
    port: Number(port),
    user,
    pass,
    from,
  };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}) {
  const smtp = getSmtpConfig();

  // ✅ Dev-safe: don't crash the app if SMTP isn't configured
  if (!smtp) {
    console.warn(
      "SMTP not configured. Skipping email send.",
      "to=",
      opts.to,
      "subject=",
      opts.subject
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  await transporter.sendMail({
    from: smtp.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
