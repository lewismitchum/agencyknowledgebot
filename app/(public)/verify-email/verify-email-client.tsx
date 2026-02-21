// app/(public)/verify-email/verify-email-client.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "idle" | "verifying" | "success" | "error";

export default function VerifyEmailClient() {
  const sp = useSearchParams();

  const token = useMemo(() => {
    return (sp.get("token") || "").trim();
  }, [sp]);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");

  async function verifyNow() {
    setMessage("");
    if (!token) {
      setStatus("error");
      setMessage("Missing token. Please open the verification link from your email again.");
      return;
    }

    setStatus("verifying");

    try {
      const r = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        setStatus("error");
        setMessage(j?.error || j?.message || raw || "Verification failed.");
        return;
      }

      setStatus("success");
      setMessage("Email verified. You can log in now.");
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "Network error.");
    }
  }

  // Auto-run once when token exists
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing token. Please open the verification link from your email again.");
      return;
    }
    verifyNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Verify email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We’re confirming your email address.
          </p>

          <div className="mt-6 rounded-2xl border bg-muted p-3 text-sm">
            <div className="font-medium">
              {status === "verifying"
                ? "Verifying…"
                : status === "success"
                ? "Verified"
                : status === "error"
                ? "Verification error"
                : "Ready"}
            </div>
            <div className="mt-1 text-muted-foreground">
              {message || (status === "verifying" ? "Please wait." : "—")}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={verifyNow}
              disabled={status === "verifying"}
              className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {status === "verifying" ? "Verifying..." : "Retry verification"}
            </button>

            <Link
              href="/login"
              className="w-full rounded-xl border bg-background px-4 py-2 text-center text-sm font-medium hover:bg-muted"
            >
              Go to login
            </Link>
          </div>

          {!token ? (
            <div className="mt-4 text-xs text-muted-foreground break-all">
              Tip: the URL should look like <code>/verify-email?token=...</code>
            </div>
          ) : (
            <div className="mt-4 text-xs text-muted-foreground break-all">
              Token detected: <code>{token.slice(0, 12)}…</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}