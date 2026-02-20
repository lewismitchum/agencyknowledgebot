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

export default function SignupPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [tsToken, setTsToken] = useState<string>("");

  // ✅ ensure we only try render after script loads
  const [turnstileReady, setTurnstileReady] = useState(false);

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    if (!turnstileReady) return;
    if (!widgetRef.current) return;
    if (!window.turnstile) return;
    if (widgetIdRef.current) return;

    try {
      widgetIdRef.current = window.turnstile.render(widgetRef.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: (token) => setTsToken(token || ""),
        "error-callback": () => setTsToken(""),
        "expired-callback": () => setTsToken(""),
      });
    } catch {
      // if render fails, allow retry on next re-render
      widgetIdRef.current = null;
    }
  }, [siteKey, turnstileReady]);

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
    const password = String(fd.get("password") || "");

    if (!name || !email || !password) {
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
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        redirect: "manual",
        body: JSON.stringify({ name, email, password, turnstile_token: tsToken }),
      });

      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location") || "";
        setOk("Account created.");
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
        setErr(j?.error || j?.message || raw || "Signup failed");
        resetTurnstile();
        return;
      }

      const redirectTo = (j && (j.redirectTo || j.redirect_to)) || "/app/chat";
      setOk("Account created.");
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
        <Script
          // ✅ explicit render mode is safer in App Router
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileReady(true)}
        />
      ) : null}

      <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:items-center">
          <div className="hidden md:block">
            <div className="rounded-3xl border bg-card p-8 shadow-sm">
              <div className="text-sm font-semibold">Start Free</div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">
                Your agency’s docs, instantly searchable.
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Upload SOPs, onboarding, pricing, and brand docs. Louis answers from what you upload—no guessing for internal info.
              </p>

              <div className="mt-6 grid gap-3">
                <Mini title="Doc-prioritized answers" body="Internal answers come from your uploads first." />
                <Mini title="Workspace isolation" body="Your data stays inside your agency." />
                <Mini title="Memory-managed" body="Long chats auto-summarize for continuity." />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Free tier includes one agency bot and a daily message limit.
            </p>

            {err ? (
              <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
                <div className="font-medium">Signup error</div>
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
                  Agency name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Let’s Alter Minds"
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
                <label className="text-sm font-medium" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="At least 10 characters"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Human verification</label>
                <div className="rounded-2xl border bg-background p-3">
                  {!siteKey ? (
                    <div className="text-xs text-muted-foreground">
                      Turnstile missing site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
                    </div>
                  ) : null}
                  <div ref={widgetRef} />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {loading ? "Creating..." : "Create account"}
              </button>

              <p className="text-xs text-muted-foreground">
                By creating an account, you agree to keep uploads confidential and to use Louis.Ai for internal knowledge only.
              </p>

              <div className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-foreground underline underline-offset-4">
                  Log in
                </Link>
                .
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

function Mini({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}