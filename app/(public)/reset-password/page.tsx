// app/(public)/reset-password/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = useMemo(() => {
    return (searchParams.get("token") || "").trim();
  }, [searchParams]);

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const pw = newPassword.trim();
    const pw2 = confirm.trim();

    if (!token) {
      setError("Missing token. Please use the link from your email again.");
      return;
    }
    if (!pw) {
      setError("Please enter a new password.");
      return;
    }
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: pw }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        setError(j?.error || j?.message || "Reset failed.");
        return;
      }

      setOk(true);
      // send them to login after a short beat
      setTimeout(() => router.push("/login"), 600);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <h1 className="text-lg font-medium">Reset Password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter a new password for your account.
          </p>

          {!token && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Missing token. Please open this page from your reset email link.
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {ok && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              Password updated. Redirecting to login…
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium">New password</label>
              <input
                type="password"
                className="mt-1 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading || ok}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Confirm new password</label>
              <input
                type="password"
                className="mt-1 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={loading || ok}
              />
            </div>

            <button
              type="submit"
              disabled={loading || ok || !token}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-50"
            >
              {loading ? "Updating…" : "Update password"}
            </button>

            <div className="text-center text-sm">
              <a className="text-muted-foreground underline underline-offset-4" href="/login">
                Back to login
              </a>
            </div>
          </form>

          <div className="mt-6 text-xs text-muted-foreground">
            Token present: <span className="font-mono">{token ? "yes" : "no"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}