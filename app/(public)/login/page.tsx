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

function looksLikeNotVerified(msg: string) {
  const s = (msg || "").toLowerCase();
  return s.includes("not verified") || s.includes("email_not_verified") || s.includes("verify your email");
}

export default function LoginPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [tsToken, setTsToken] = useState<string>("");

  // remember email user tried (for resend)
  const [lastEmail, setLastEmail] = useState<string>("");

  // when script loads AFTER first render, we trigger another render attempt
  const [scriptReady, setScriptReady] = useState(false);

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
  }, [siteKey, scriptReady]);

  function resetTurnstile() {
    const id = widgetIdRef.current;
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id);
      } catch {}
    }
    setTsToken("");
  }

  async function onResendVerification() {
    setErr("");
    setOk("");

    const email = (lastEmail || "").trim().toLowerCase();
    if (!email) {
      setErr("Enter your email, then try logging in once so I know where to resend.");
      return;
    }

    setResending(true);
    try {
      const r = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      // your API should return ok even if email doesn't exist (avoid enumeration)
      if (!r.ok) {
        const raw = await r.text().catch(() => "");
        setErr(raw || "Could not resend verification email.");
        return;
      }

      setOk("If an account exists for that email, we just sent a new verification link. Check your inbox/spam.");
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setResending(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");

    setLastEmail(email);

    if (!email || !password) {
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
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        redirect: "manual",
        body: JSON.stringify({ email, password, turnstile_token: tsToken }),
      });

      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location") || "";
        setOk("Logged in.");
        window.location.href = loc || "/app/chat";
        return;
      }

      const ct = r.headers.get("content-type") || "";
      const raw = await r.text().catch(() => "");
      let j: any = null;

      if (ct.includes("application/json")) {
        try {
          j = raw ? JSON.parse(raw) : null;
        } catch {}
      }

      if (!r.ok) {
        const msg = j?.error || j?.message || raw || "Login failed";
        setErr(msg);
        resetTurnstile();
        return;
      }

      const redirectTo = (j && (j.redirectTo || j.redirect_to)) || "/app/chat";
      setOk("Logged in.");
      window.location.href = redirectTo;
    } catch (e: any) {
      setErr(e?.message || "Network error");
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  const showResend = looksLikeNotVerified(err);

  return (
    <>
      {siteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
      ) : null}

      <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <div className="mx-auto grid max-w-xl gap-6">
          <div className="rounded-3xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
            <p className="mt-2 text-sm text-muted-foreground">Welcome back.</p>

            {err ? (
              <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
                <div className="font-medium">Login error</div>
                <div className="mt-1 text-muted-foreground">{err}</div>

                {showResend ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={onResendVerification}
                      disabled={resending}
                      className="rounded-xl border bg-background px-3 py-2 text-sm hover:opacity-90 disabled:opacity-60"
                    >
                      {resending ? "Sending..." : "Resend verification email"}
                    </button>
                  </div>
                ) : null}
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
                <label className="text-sm font-medium" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Your password"
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
                {loading ? "Logging in..." : "Log in"}
              </button>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <Link href="/forgot-password" className="underline underline-offset-4">
                  Forgot password?
                </Link>
                <span>
                  New here?{" "}
                  <Link href="/signup" className="text-foreground underline underline-offset-4">
                    Create account
                  </Link>
                </span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}