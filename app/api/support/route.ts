import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function verifyTurnstile(token: string, ip?: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!secret) {
    return { ok: false, error: "Server misconfigured (missing TURNSTILE_SECRET_KEY)." };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = (await r.json().catch(() => null)) as any;
  if (!j || !j.success) return { ok: false, error: "Captcha verification failed." };
  return { ok: true };
}

export async function POST(req: Request) {
  try {
    const json = (await req.json().catch(() => null)) as any;
    const name = String(json?.name || "").trim();
    const email = String(json?.email || "").trim();
    const topic = String(json?.topic || "").trim();
    const message = String(json?.message || "").trim();
    const turnstileToken = String(json?.turnstile_token || "").trim();

    if (!name || !email || !topic || !message) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!turnstileToken) {
      return NextResponse.json({ error: "Missing captcha token" }, { status: 400 });
    }

    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;

    const v = await verifyTurnstile(turnstileToken, ip);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }

    // Minimal for launch: log to server so you at least receive it in Vercel logs.
    // Later: wire Resend/SendGrid + store in DB.
    console.log("[SUPPORT]", { name, email, topic, message });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}