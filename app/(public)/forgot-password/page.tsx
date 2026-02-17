"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "");

    try {
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!r.ok) {
        setErr(j?.error || raw || "Request failed");
        return;
      }

      // Always show success (no account enumeration)
      setOk("If that email exists, you’ll receive a reset link shortly.");
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
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
              <label className="text-sm font-medium" htmlFor="email">Email</label>
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
  );
}
