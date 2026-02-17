import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";
import { ensureSchema } from "@/lib/schema";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
