// app/check-email/page.tsx
"use client";

import { useMemo, useState } from "react";

export default function CheckEmailPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>("");

  const canSubmit = useMemo(() => {
    const e = email.trim();
    return e.length >= 6 && e.includes("@") && e.includes(".");
  }, [email]);

  async function resend() {
    if (!canSubmit || busy) return;

    setBusy(true);
    setSent(false);
    setError("");

    try {
      const r = await fetch("/api/auth/resend-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (r.status === 429) {
        setError("Too many resend attempts. Please wait a few minutes and try again.");
        return;
      }

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(String(j?.message ?? j?.error ?? "Failed to resend email"));
        return;
      }

      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to resend email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center p-6">
      <div className="w-full rounded-3xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a verification link. Click it to activate your workspace.
        </p>

        <div className="mt-6 space-y-2">
          <label className="text-sm font-medium">Resend link</label>
          <input
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <button
            onClick={resend}
            disabled={!canSubmit || busy}
            className="mt-2 h-11 w-full rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
          >
            {busy ? "Sending..." : "Resend verification email"}
          </button>

          {sent ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Sent. If you don’t see it, check spam/junk.
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : null}

          <div className="pt-2 text-xs text-muted-foreground">
            Tip: search your inbox for <span className="font-mono">Louis.Ai</span>.
          </div>
        </div>
      </div>
    </div>
  );
}