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

export default function LoginPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");

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
        body: JSON.stringify({ email, password, turnstile_token: tsToken }),
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!r.ok) {
        setErr(j?.error || j?.message || raw || "Login failed");
        resetTurnstile();
        return;
      }

      const redirectTo = (j && (j.redirectTo || j.redirect_to)) || "/app/chat";
      window.location.href = redirectTo;
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
        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:items-center">
          <div className="hidden md:block">
            <div className="rounded-3xl border bg-card p-8 shadow-sm">
              <div className="text-sm font-semibold">Louis.Ai</div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">
                Secure AI for your agency.
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Internal answers are sourced from your uploaded documents first. General questions still work.
              </p>
              <div className="mt-6 rounded-2xl bg-muted p-4 font-mono text-sm">
                I don’t have that information in the docs yet.
              </div>
              <div className="mt-6 text-sm text-muted-foreground">
                New here?{" "}
                <Link href="/signup" className="text-foreground underline underline-offset-4">
                  Create an account
                </Link>
                .
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-2 text-sm text-muted-foreground">Log in to your workspace.</p>

            {err ? (
              <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
                <div className="font-medium">Login error</div>
                <div className="mt-1 text-muted-foreground">{err}</div>
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

                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl border bg-background px-3 py-2 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring"
                    placeholder="••••••••"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
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

              <div className="flex items-center justify-between text-sm">
                <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
                  Forgot password?
                </Link>
                <Link href="/signup" className="text-muted-foreground hover:text-foreground">
                  Create account
                </Link>
              </div>
            </form>

            <div className="mt-8 md:hidden">
              <div className="rounded-2xl bg-muted p-4 font-mono text-sm">
                I don’t have that information in the docs yet.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="block" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="block" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.88 5.09A10.53 10.53 0 0 1 12 5c6.5 0 10 7 10 7a18.3 18.3 0 0 1-2.2 3.19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M6.61 6.61C3.8 8.67 2 12 2 12s3.5 7 10 7c1.2 0 2.32-.2 3.35-.55"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M2 2l20 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}