"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const token = useMemo(() => String(sp.get("token") || "").trim(), [sp]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");

    if (!token) {
      setErr("Missing token. Please request a new reset link.");
      return;
    }

    const fd = new FormData(e.currentTarget);
    const new_password = String(fd.get("new_password") || "");
    const confirm = String(fd.get("confirm_password") || "");

    if (new_password.length < 10) {
      setErr("Password must be at least 10 characters.");
      return;
    }
    if (new_password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, new_password }),
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!r.ok) {
        const code = j?.error || raw || "Reset failed";
        if (code === "TOKEN_EXPIRED") {
          setErr("That reset link expired. Please request a new one.");
        } else if (code === "INVALID_TOKEN") {
          setErr("Invalid reset link. Please request a new one.");
        } else {
          setErr(code);
        }
        return;
      }

      setOk("Password updated. You can log in now.");
      setTimeout(() => router.push("/login"), 800);
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
          <p className="mt-2 text-sm text-muted-foreground">
            This link expires in 60 minutes. If it expired, request a new reset link.
          </p>

          {!token ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Missing reset token</div>
              <div className="mt-1 text-muted-foreground">
                Please go back and request a new reset link.
              </div>
            </div>
          ) : null}

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
              <label className="text-sm font-medium" htmlFor="new_password">
                New password
              </label>
              <input
                id="new_password"
                name="new_password"
                type="password"
                required
                autoComplete="new-password"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="At least 10 characters"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="confirm_password">
                Confirm password
              </label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                required
                autoComplete="new-password"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Repeat password"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Updating..." : "Update password"}
            </button>

            <div className="flex items-center justify-between text-sm">
              <Link href="/login" className="text-muted-foreground hover:text-foreground">
                Back to login
              </Link>
              <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
                Request new link
              </Link>
            </div>
          </form>

          <div className="mt-6 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
            If you didn’t request this reset, you can ignore it.
          </div>
        </div>
      </div>
    </div>
  );
}