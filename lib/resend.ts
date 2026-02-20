// lib/resend.ts
import { Resend } from "resend";

export function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY_MISSING");
  }
  return new Resend(key);
}

export function getEmailFrom() {
  // Example: "Louis.Ai <support@louis.ai>"
  const from = process.env.RESEND_FROM;
  if (!from) {
    throw new Error("RESEND_FROM_MISSING");
  }
  return from;
}

export function getAppBaseUrl() {
  // Prefer explicit URL (custom domain), otherwise Vercel URL
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`.replace(/\/+$/, "");

  // Local fallback
  return "http://localhost:3000";
}