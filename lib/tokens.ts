import crypto from "crypto";

export function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isoFromNowMinutes(mins: number) {
  return new Date(Date.now() + mins * 60_000).toISOString();
}

export function nowIso() {
  return new Date().toISOString();
}

export function minutesSince(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}
