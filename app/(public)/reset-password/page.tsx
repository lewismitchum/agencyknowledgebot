"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export default function ResetPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    const sp = new URLSearchParams(window.location.search);
    return sp.get("token") || "";
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");

    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!r.ok) {
        setErr(j?.error || raw || "Reset failed");
        return;
      }

      setOk("Password updated. Redirecting to login…");
      setTimeout(() => {
        window.location.href = "/login";
      }, 700);
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
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="mt-2 text-sm text-muted-foreground">Set a new password for your account.</p>

          {!token ? (
            <div className="mt-6 rounded-2xl border bg-muted p-4 text-sm">
              Missing reset token. Please request a new reset link.
              <div className="mt-3">
                <Link
                  href="/forgot-password"
                  className="inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Request reset
                </Link>
              </div>
            </div>
          ) : (
            <>
              {err ? (
                <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
                  <div className="font-medium">Reset error</div>
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
                  <label className="text-sm font-medium" htmlFor="password">
                    New password
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
                  {loading ? "Updating..." : "Update password"}
                </button>

                <div className="text-sm text-muted-foreground">
                  Remembered it?{" "}
                  <Link href="/login" className="text-foreground underline underline-offset-4">
                    Back to login
                  </Link>
                  .
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
