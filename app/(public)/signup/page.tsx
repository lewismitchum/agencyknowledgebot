// app/(public)/signup/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");

    if (!name || !email || !password) {
      setErr("Missing fields");
      setLoading(false);
      return;
    }

    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // IMPORTANT: do not follow redirects in fetch; we want to handle navigation ourselves.
        redirect: "manual",
        body: JSON.stringify({ name, email, password }),
      });

      // 302/303/etc come back here with redirect: "manual"
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
        return;
      }

      // If backend ever returns JSON ok:true (instead of redirect), still handle it.
      const redirectTo =
        (j && (j.redirectTo || j.redirect_to)) ||
        // With SMTP off (your case), signup should go to chat
        "/app/chat";

      setOk("Account created.");
      window.location.href = redirectTo;
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:items-center">
        <div className="hidden md:block">
          <div className="rounded-3xl border bg-card p-8 shadow-sm">
            <div className="text-sm font-semibold">Start Free</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              Your agency’s docs, instantly searchable.
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Upload SOPs, onboarding, pricing, and brand docs. Louis answers only from what you upload—no hallucinations.
            </p>

            <div className="mt-6 grid gap-3">
              <Mini title="Docs-only enforcement" body="If it’s not in the docs, Louis says so." />
              <Mini title="Workspace isolation" body="Your data stays inside your agency." />
              <Mini title="Production-safe" body="Graceful fallback on errors and limits." />
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
                placeholder="••••••••"
              />
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