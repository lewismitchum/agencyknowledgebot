"use client";

// app/(public)/verify-email/verify-email-client.tsx
import Link from "next/link";
import { useEffect, useState } from "react";

export default function VerifyEmailClient({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "verifying" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setStatus("error");
        setMessage("This link is missing a token. Please use the verification link from your email.");
        return;
      }

      setStatus("verifying");
      setMessage("");

      try {
        const r = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const j = await r.json().catch(() => ({}));

        if (!r.ok) {
          setStatus("error");
          setMessage(j?.error || "Invalid or expired link.");
          return;
        }

        setStatus("ok");
        setMessage("Email verified. Redirecting…");

        // Give the user a beat to see success, then send them to login/chat.
        setTimeout(() => {
          window.location.href = "/login";
        }, 700);
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setMessage(e?.message || "Network error.");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <h1 className="text-lg font-medium">Verify email</h1>

          {status === "verifying" ? (
            <p className="mt-2 text-sm text-muted-foreground">Verifying…</p>
          ) : null}

          {status === "ok" ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Success</div>
              <div className="mt-1 text-muted-foreground">{message}</div>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Missing verification token</div>
              <div className="mt-1 text-muted-foreground">{message}</div>
            </div>
          ) : null}

          <div className="mt-6 flex items-center gap-3 text-sm">
            <Link href="/login" className="underline underline-offset-4">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}