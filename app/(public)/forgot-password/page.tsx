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

export default function ForgotPasswordPage() {
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
    if (!window.turnstile) return;
    if (widgetIdRef.current) return;

    widgetIdRef.current = window.turnstile.render(widgetRef.current, {
      sitekey: siteKey,
      theme: "auto",
      callback: (token) => setTsToken(token || ""),
      "error-callback": () => setTsToken(""),
      "expired-callback": () => setTsToken(""),
    });
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
    const email = String(fd.get("email") || "");

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
      const r = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, turnstile_token: tsToken }),
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!r.ok) {
        setErr(j?.error || raw || "Request failed");
        resetTurnstile();
        return;
      }

      setOk("If that email exists, you’ll receive a reset link shortly.");
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
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      ) : null}

      <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <div className="mx-auto max-w-xl">
          <div className="rounded-3xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter your email and we’ll send a reset link. If the email exists, you’ll receive instructions.
            </p>

            {err ? (
              <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
                <div className="font-medium">Request error</div>
                <div className="mt-1 text-muted-foreground">{err}</div>
              </div>
            ) : null}

            {ok ? (
              <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
                <div className="font-medium">Check your inbox</div>
                <div className="mt-1 text-muted-foreground">{ok}</div>
              </div>
            ) : null}

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
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
                {loading ? "Sending..." : "Send reset link"}
              </button>

              <div className="flex items-center justify-between text-sm">
                <Link href="/login" className="text-muted-foreground hover:text-foreground">
                  Back to login
                </Link>
                <Link href="/signup" className="text-muted-foreground hover:text-foreground">
                  Create account
                </Link>
              </div>
            </form>

            <div className="mt-6 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
              Security note: we don’t reveal whether an email exists.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}