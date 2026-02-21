// app/(public)/check-email/page.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export default function CheckEmailPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const canSend = useMemo(() => {
    const v = email.trim();
    return v.length > 3 && v.includes("@");
  }, [email]);

  async function onResend(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend || status === "sending") return;

    setStatus("sending");
    setError(null);

    try {
      const r = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || "Failed to resend verification email");
      }

      setStatus("sent");
    } catch (err: any) {
      setStatus("error");
      setError(String(err?.message ?? err));
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white/70 dark:bg-black/20 backdrop-blur p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a verification link to your inbox. Click it to activate your workspace.
        </p>

        <div className="mt-4 rounded-xl border p-4 text-sm">
          <ul className="list-disc pl-5 space-y-1">
            <li>Check spam/promotions.</li>
            <li>Make sure the email is correct.</li>
            <li>The link expires in 60 minutes.</li>
          </ul>
        </div>

        <form className="mt-5 space-y-3" onSubmit={onResend}>
          <label className="block text-sm font-medium">Resend verification</label>
          <input
            className="w-full rounded-xl border px-3 py-2 bg-transparent"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <button
            type="submit"
            disabled={!canSend || status === "sending"}
            className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-60"
          >
            {status === "sending" ? "Sending..." : "Resend verification email"}
          </button>

          {status === "sent" && (
            <p className="text-sm text-green-600">
              If that email exists, a verification link was sent.
            </p>
          )}
          {status === "error" && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link className="underline" href="/login">
            Back to login
          </Link>
          <Link className="underline" href="/support">
            Contact support
          </Link>
        </div>
      </div>
    </div>
  );
}

// Force module status even if something mangles the file.
export {};