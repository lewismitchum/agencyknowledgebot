// app/(public)/verify-email/verify-email-client.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function VerifyEmailClient({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setStatus("error");
        setMessage("This link is missing a token. Please use the verification link from your email.");
        return;
      }

      setStatus("loading");
      setMessage("");

      try {
        const r = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        const ct = r.headers.get("content-type") || "";
        const raw = await r.text().catch(() => "");
        let j: any = null;

        if (ct.includes("application/json")) {
          try {
            j = raw ? JSON.parse(raw) : null;
          } catch {}
        }

        if (!r.ok) {
          const err = j?.error || j?.message || raw || "Verification failed";
          if (cancelled) return;
          setStatus("error");
          setMessage(err);
          return;
        }

        if (cancelled) return;
        setStatus("ok");
        setMessage("Email verified. You can log in now.");
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setMessage(e?.message || "Network error");
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
          <h1 className="text-2xl font-semibold tracking-tight">Verify email</h1>

          {status === "loading" ? (
            <p className="mt-3 text-sm text-muted-foreground">Verifying…</p>
          ) : null}

          {status === "ok" ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Success</div>
              <div className="mt-1 text-muted-foreground">{message}</div>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Verification error</div>
              <div className="mt-1 text-muted-foreground">{message}</div>
            </div>
          ) : null}

          <div className="mt-6 flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Back to login
            </Link>

            <Link href="/" className="text-sm underline underline-offset-4 text-muted-foreground">
              Home
            </Link>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Reminder: Louis prioritizes your uploaded docs for internal answers.
          </p>
        </div>
      </div>
    </div>
  );
}