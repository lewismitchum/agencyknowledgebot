// app/(public)/check-email/check-email-client.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

function normalizeEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

function isValidEmail(v: string) {
  const s = normalizeEmail(v);
  return s.length > 3 && s.includes("@");
}

export default function CheckEmailClient() {
  const sp = useSearchParams();

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Local UI throttle (server also throttles; this just avoids spam clicks)
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<number | null>(null);

  useEffect(() => {
    const fromQuery = String(sp.get("email") || "").trim();
    if (fromQuery && fromQuery.includes("@")) setEmail(fromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    if (cooldownRef.current) return;

    cooldownRef.current = window.setInterval(() => {
      setCooldown((s) => {
        const next = Math.max(0, s - 1);
        if (next === 0 && cooldownRef.current) {
          window.clearInterval(cooldownRef.current);
          cooldownRef.current = null;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (cooldownRef.current) {
        window.clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, [cooldown]);

  const canSend = useMemo(() => isValidEmail(email), [email]);
  const sending = status === "sending";
  const disabled = !canSend || sending || cooldown > 0;

  async function onResend(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;

    setStatus("sending");
    setError(null);

    const normalized = normalizeEmail(email);

    try {
      const r = await fetchJson("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: normalized }),
      });

      // This route intentionally returns {ok:true} even if the email doesn't exist.
      if (!r.ok) {
        const raw = await r.text().catch(() => "");
        // Don't leak specifics; just show a generic retry message.
        throw new Error(raw || "Could not resend verification email. Please try again.");
      }

      setStatus("sent");
      // match server throttle (2 minutes)
      setCooldown(120);
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
            inputMode="email"
          />

          <button
            type="submit"
            disabled={disabled}
            className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-60"
          >
            {sending ? "Sending..." : cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend verification email"}
          </button>

          {status === "sent" ? (
            <p className="text-sm text-green-600">
              If an account exists for that email, a verification link was sent. Check your inbox/spam.
            </p>
          ) : null}

          {status === "error" ? <p className="text-sm text-red-600">{error}</p> : null}
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