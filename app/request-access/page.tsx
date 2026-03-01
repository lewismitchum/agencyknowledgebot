// app/request-access/page.tsx
"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
      remove?: (widgetId: string) => void;
    };
  }
}

function isEmail(s: string) {
  const v = String(s || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function RequestAccessPage() {
  const siteKey = useMemo(() => String(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim(), []);

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  const [tsToken, setTsToken] = useState("");

  const [agency, setAgency] = useState(""); // can be name or email
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  function renderTurnstile() {
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
  }

  useEffect(() => {
    // Handles client-side nav where script is already present
    renderTurnstile();

    return () => {
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      setTsToken("");

      try {
        if (id && window.turnstile?.remove) window.turnstile.remove(id);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetTurnstile() {
    const id = widgetIdRef.current;
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id);
      } catch {}
    }
    setTsToken("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");

    const a = agency.trim();
    const u = email.trim().toLowerCase();
    const p = password;

    if (!a) return setErr("Enter the agency name or agency email.");
    if (!isEmail(u)) return setErr("Enter a valid email.");
    if (!p || p.trim().length < 8) return setErr("Password must be at least 8 characters.");

    if (!siteKey) return setErr("Turnstile misconfigured (missing site key).");
    if (!tsToken) return setErr("Please complete the captcha.");

    setLoading(true);
    try {
      const payload: any = { email: u, password: p, turnstile_token: tsToken };
      if (isEmail(a)) payload.agency_email = a.toLowerCase();
      else payload.agency_name = a;

      const r = await fetch("/api/auth/request-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        const code = String(j?.error || j?.message || "").trim();
        if (code === "AGENCY_NOT_FOUND") {
          setErr("No workspace found with that agency name/email.");
        } else if (code === "USER_ALREADY_EXISTS") {
          setErr("You already have an account in this workspace. Try logging in.");
        } else if (code === "EMAIL_ALREADY_IN_USE") {
          setErr("That email is already in use in another workspace.");
        } else if (code) {
          setErr(code);
        } else {
          setErr(`Request failed (HTTP ${r.status})`);
        }
        resetTurnstile();
        return;
      }

      setOk("Request submitted. An owner/admin must approve you before you can log in.");
      resetTurnstile();

      window.setTimeout(() => {
        window.location.href = "/pending-approval";
      }, 600);
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
          onLoad={() => {
            renderTurnstile();
          }}
        />
      ) : null}

      <div className="mx-auto w-full max-w-xl px-4 py-10">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Request access</CardTitle>
                <CardDescription className="mt-1">
                  Ask to join an existing workspace. You’ll be pending until approved.
                </CardDescription>
              </div>
              <Badge variant="secondary">Louis.Ai</Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {err ? (
              <div className="rounded-2xl border bg-muted p-3 text-sm">
                <div className="font-medium">Error</div>
                <div className="mt-1 text-muted-foreground">{err}</div>
              </div>
            ) : null}

            {ok ? (
              <div className="rounded-2xl border bg-muted p-3 text-sm">
                <div className="font-medium">Submitted</div>
                <div className="mt-1 text-muted-foreground">{ok}</div>
              </div>
            ) : null}

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Agency name or agency email</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  placeholder="Acme Creative (or owner@acme.com)"
                  autoComplete="organization"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Your email</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@acme.com"
                  type="email"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Create a password</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  type="password"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Human verification</label>
                <div className="rounded-2xl border bg-background p-3">
                  <div ref={widgetRef} />
                </div>
              </div>

              <Button className="w-full" disabled={loading}>
                {loading ? "Submitting…" : "Request access"}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <Link className="text-muted-foreground underline" href="/login">
                  Back to login
                </Link>
                <Link className="text-muted-foreground underline" href="/support">
                  Need help?
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}