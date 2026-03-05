// app/(public)/support/page.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type ApiResp =
  | { ok: true; ticket_id?: string; message?: string }
  | { ok?: false; error?: string; message?: string };

function normalizeEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

export default function SupportPage() {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const canSubmit = useMemo(() => {
    return normalizeEmail(email).includes("@") && subject.trim().length > 1 && message.trim().length > 5;
  }, [email, subject, message]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setErr("");
    setOk("");
    setLoading(true);

    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // public: no credentials
        body: JSON.stringify({
          email: normalizeEmail(email),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });

      const raw = await r.text().catch(() => "");
      let j: ApiResp | null = null;
      try {
        j = raw ? (JSON.parse(raw) as ApiResp) : null;
      } catch {}

      if (!r.ok || !j || !(j as any).ok) {
        setErr(String((j as any)?.error || (j as any)?.message || raw || "Could not send message. Please try again."));
        return;
      }

      setOk(String((j as any)?.message || "Message sent. We’ll reply as soon as we can."));
      setEmail("");
      setSubject("");
      setMessage("");
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Contact support</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Send us a message and we’ll get back to you by email.
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Error</div>
              <div className="mt-1 text-muted-foreground">{err}</div>
            </div>
          ) : null}

          {ok ? (
            <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Sent</div>
              <div className="mt-1 text-muted-foreground">{ok}</div>
            </div>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="email">
                Your email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="subject">
                Subject
              </label>
              <input
                id="subject"
                type="text"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="What can we help with?"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                className="min-h-[140px] w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Describe the issue (include screenshots if possible)."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send message"}
            </button>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <Link href="/login" className="underline underline-offset-4">
                Back to login
              </Link>
              <Link href="/pricing" className="underline underline-offset-4">
                Pricing
              </Link>
            </div>
          </form>

          <div className="mt-6 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
            Don’t include passwords or sensitive secrets in your message.
          </div>
        </div>
      </div>
    </div>
  );
}