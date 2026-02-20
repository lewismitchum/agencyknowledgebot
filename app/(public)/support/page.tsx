"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId: string) => void;
    };
  }
}

export default function SupportPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [tsToken, setTsToken] = useState<string>("");

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    if (!widgetRef.current) return;

    const tryRender = () => {
      if (!window.turnstile) return;
      if (widgetIdRef.current) return;

      widgetIdRef.current = window.turnstile.render(widgetRef.current!, {
        sitekey: siteKey,
        theme: "auto",
        callback: (token) => setTsToken(token || ""),
        "error-callback": () => setTsToken(""),
        "expired-callback": () => setTsToken(""),
      });
    };

    tryRender();
    const t = window.setInterval(tryRender, 200);
    return () => window.clearInterval(t);
  }, [siteKey]);

  function resetTurnstile() {
    const id = widgetIdRef.current;
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id);
      } catch {}
    }
    setTsToken("");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");

    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const topic = String(fd.get("topic") || "").trim();
    const message = String(fd.get("message") || "").trim();

    if (!name || !email || !topic || !message) {
      setErr("Missing fields");
      return;
    }

    if (!siteKey) {
      setErr("Turnstile misconfigured (missing site key).");
      return;
    }

    if (!tsToken) {
      setErr("Please complete the captcha.");
      return;
    }

    setLoading(true);

    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          topic,
          message,
          turnstile_token: tsToken,
        }),
      });

      const ct = r.headers.get("content-type") || "";
      const raw = await r.text().catch(() => "");
      let j: any = null;

      if (ct.includes("application/json")) {
        try {
          j = raw ? JSON.parse(raw) : null;
        } catch {}
      }

      if (!r.ok) {
        setErr(j?.error || j?.message || raw || "Request failed");
        resetTurnstile();
        return;
      }

      setOk("Message sent. We’ll get back to you ASAP.");
      (e.currentTarget as HTMLFormElement).reset();
      resetTurnstile();
    } catch (e: any) {
      setErr(e?.message || "Network error");
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {siteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
        />
      ) : null}

      <div className="mx-auto max-w-3xl px-4 py-14 md:py-20">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
            <Link href="/" className="text-sm underline underline-offset-4">
              Home
            </Link>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            Send us a message and we’ll reply by email. (Human verification required.)
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Error</div>
              <div className="mt-1 text-muted-foreground">{err}</div>
            </div>
          ) : null}

          {ok ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Success</div>
              <div className="mt-1 text-muted-foreground">{ok}</div>
            </div>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Lewis"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@agency.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="topic">
                Topic
              </label>
              <input
                id="topic"
                name="topic"
                type="text"
                required
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Login issue"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                name="message"
                required
                rows={6}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Tell us what happened, what you expected, and any error message."
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Human verification</label>
              <div className="rounded-2xl border bg-background p-3">
                <div ref={widgetRef} />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send message"}
            </button>

            <p className="text-xs text-muted-foreground">
              Please don’t include passwords or private client data in your message.
            </p>
          </form>
        </div>
      </div>
    </>
  );
}