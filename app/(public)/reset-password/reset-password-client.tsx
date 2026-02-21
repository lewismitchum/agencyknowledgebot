"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ResetPasswordClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const token = useMemo(() => {
    // accept token from ?token=... or ?t=...
    return (sp.get("token") || sp.get("t") || "").trim();
  }, [sp]);

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) return setError("Missing reset token. Please use the link from your email.");
    if (!newPassword.trim()) return setError("Missing new password.");
    if (newPassword.length < 8) return setError("Password must be at least 8 characters.");
    if (newPassword !== confirm) return setError("Passwords do not match.");

    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: newPassword }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        setError(j?.error || j?.message || "Reset failed.");
        return;
      }

      setOk(true);
      // optional: bounce to login after a moment
      setTimeout(() => router.push("/login"), 800);
    } catch (err: any) {
      setError(err?.message || "Reset failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <h1 className="text-lg font-medium">Reset Password</h1>
          <p className="text-sm text-muted-foreground">
            Enter a new password for your workspace.
          </p>

          {!token && (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              Missing reset token. Open the reset link from your email again.
            </div>
          )}

          {ok ? (
            <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              Password updated. Redirecting to login…
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">New password</label>
                <input
                  type="password"
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm password</label>
                <input
                  type="password"
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !token}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
              >
                {submitting ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}