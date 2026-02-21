// app/(public)/reset-password/reset-password-client.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

export default function ResetPasswordClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const token = useMemo(() => (sp.get("token") || "").trim(), [sp]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing reset token. Please use the link from your email again.");
      return;
    }
    if (!password.trim()) {
      setError("Please enter a new password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || j?.message || "Reset failed.");
        return;
      }

      setOk(true);
      setTimeout(() => router.push("/login"), 600);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <PageShell>
        <h1 className="text-lg font-medium">Reset Password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This reset link is missing a token.
        </p>
        <div className="mt-4 rounded-2xl border p-4 text-sm">
          Please go back to <span className="font-medium">Forgot password</span> and request a new link.
        </div>
        <button
          className="mt-6 w-full rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          onClick={() => router.push("/forgot-password")}
        >
          Go to Forgot Password
        </button>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 className="text-lg font-medium">Reset Password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a new password for your account.
      </p>

      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="text-sm font-medium">New password</label>
          <input
            className="mt-1 w-full rounded-2xl border bg-transparent px-3 py-2 text-sm outline-none"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Confirm new password</label>
          <input
            className="mt-1 w-full rounded-2xl border bg-transparent px-3 py-2 text-sm outline-none"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
            {error}
          </div>
        ) : null}

        {ok ? (
          <div className="rounded-2xl border border-green-500/40 bg-green-500/10 p-3 text-sm">
            Password updated. Redirecting to login…
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Resetting…" : "Reset Password"}
        </button>
      </form>
    </PageShell>
  );
}