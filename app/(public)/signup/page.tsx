// app/(public)/signup/page.tsx
"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";

// Avoid redeclaring global turnstile type to prevent conflicts with other type definitions.
// We will cast window.turnstile to any where needed.

function getQuery() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search || "");
}

function normalizeEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

export default function SignupPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [tsToken, setTsToken] = useState("");
  const [tsReady, setTsReady] = useState(false);

  const [prefillEmail, setPrefillEmail] = useState("");
  const [nextPath, setNextPath] = useState("/app");
  const [isInvite, setIsInvite] = useState(false);
  const [inviteToken, setInviteToken] = useState("");

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const q = getQuery();

    const email = String(q.get("email") || "").trim();
    const next = String(q.get("next") || "").trim();
    const invite = String(q.get("invite") || "").trim();
    const token = String(q.get("token") || q.get("invite_token") || "").trim();

    if (email) setPrefillEmail(email);
    if (next) setNextPath(next);
    if (invite === "1" || invite.toLowerCase() === "true") setIsInvite(true);
    if (token) {
      setInviteToken(token);
      setIsInvite(true);
    }
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    if (!tsReady) return;
    if (!widgetRef.current) return;
    if (!(window as any).turnstile) return;
    if (widgetIdRef.current) return;

    widgetIdRef.current = (window as any).turnstile.render(widgetRef.current, {
      sitekey: siteKey,
      theme: "auto",
      callback: (token: string) => setTsToken(token || ""),
      "error-callback": () => setTsToken(""),
      "expired-callback": () => setTsToken(""),
    });
  }, [siteKey, tsReady]);

  function resetTurnstile() {
    const id = widgetIdRef.current;
    if (id && (window as any).turnstile) {
      try {
        (window as any).turnstile.reset(id);
      } catch {}
    }
    setTsToken("");
  }

  const headline = useMemo(() => {
    return isInvite ? "Finish your account" : "Create your workspace";
  }, [isInvite]);

  const subhead = useMemo(() => {
    return isInvite
      ? "You were invited — set a password to join the workspace."
      : "Free tier includes one agency bot and a daily message limit.";
  }, [isInvite]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");

    const fd = new FormData(e.currentTarget);

    const nameOrAgency = String(fd.get("name") || "").trim();
    const email = normalizeEmail(String(fd.get("email") || ""));
    const password = String(fd.get("password") || "").trim();

    if (!email || !password || (!isInvite && !nameOrAgency)) {
      setErr("Missing fields");
      return;
    }

    if (!siteKey) {
      setErr("Turnstile misconfigured (missing site key).");
      return;
    }

    if (!tsReady) {
      setErr("Captcha is still loading. Please wait a moment and try again.");
      return;
    }

    if (!tsToken) {
      setErr("Please complete the captcha.");
      return;
    }

    setLoading(true);

    try {
      const body: Record<string, any> = {
        email,
        password,
        turnstile_token: tsToken,
        next: nextPath || "/app",
      };

      if (!isInvite) {
        body.agencyName = nameOrAgency;
        body.name = nameOrAgency;
      } else {
        body.name = nameOrAgency || "Invited User";
        body.invite = true;
        if (inviteToken) body.invite_token = inviteToken;
      }

      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
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
        const missing = Array.isArray(j?.missing) ? j.missing.join(", ") : "";
        setErr(
          missing
            ? `Missing fields: ${missing}`
            : j?.error || j?.message || raw || "Signup failed"
        );
        resetTurnstile();
        return;
      }

      const redirectTo = (j && (j.redirectTo || j.redirect_to)) || nextPath || "/app";
      setOk("Account created.");
      window.location.href = String(redirectTo);
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
          strategy="afterInteractive"
          onLoad={() => setTsReady(true)}
        />
      ) : null}

      <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:items-center">
          <div className="hidden md:block">
            <div className="rounded-3xl border bg-card p-8 shadow-sm">
              <div className="text-sm font-semibold">{isInvite ? "You’re invited" : "Start Free"}</div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">
                Your agency’s docs, instantly searchable.
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Upload SOPs, onboarding, pricing, and brand docs. Louis answers from what you upload—no
                guessing for internal info.
              </p>

              <div className="mt-6 grid gap-3">
                <Mini title="Doc-prioritized answers" body="Internal answers come from your uploads first." />
                <Mini title="Workspace isolation" body="Your data stays inside your agency." />
                <Mini title="Memory-managed" body="Long chats auto-summarize for continuity." />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">{headline}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{subhead}</p>

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
                  {isInvite ? "Display name (optional)" : "Agency name"}
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required={!isInvite}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder={isInvite ? "Your name" : "Let’s Alter Minds"}
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
                  defaultValue={prefillEmail}
                  readOnly={!!prefillEmail}
                  className={[
                    "w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring",
                    prefillEmail ? "opacity-90" : "",
                  ].join(" ")}
                  placeholder="you@agency.com"
                />
                {prefillEmail ? (
                  <div className="text-xs text-muted-foreground">Email prefilled from invite.</div>
                ) : null}
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
                  <div ref={widgetRef} />
                  {!siteKey ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Missing NEXT_PUBLIC_TURNSTILE_SITE_KEY
                    </div>
                  ) : !tsReady ? (
                    <div className="mt-2 text-xs text-muted-foreground">Loading captcha…</div>
                  ) : null}
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
                By creating an account, you agree to keep uploads confidential and to use Louis.Ai for
                internal knowledge only.
              </p>

              <div className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href={`/login${
                    prefillEmail
                      ? `?email=${encodeURIComponent(prefillEmail)}&next=${encodeURIComponent(nextPath)}`
                      : ""
                  }`}
                  className="text-foreground underline underline-offset-4"
                >
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