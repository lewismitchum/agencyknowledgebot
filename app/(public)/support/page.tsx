// app/(public)/support/page.tsx
"use client";

import { useMemo, useState } from "react";

export default function SupportPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pageUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setDone(null);

    if (!message.trim()) {
      setErr("Please enter a message.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, pageUrl }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        setErr(data?.error || "Failed to send. Try again.");
        return;
      }

      setDone("Sent! We’ll get back to you shortly.");
      setMessage("");
    } catch {
      setErr("Failed to send. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-white/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Support</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Send us a message and we’ll reply as soon as possible.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium">Name (optional)</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Email (optional)</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              type="email"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Message</label>
            <textarea
              className="mt-1 w-full rounded-xl border px-3 py-2 bg-white min-h-[140px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="How can we help?"
            />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          {done ? <div className="text-sm text-green-700">{done}</div> : null}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-black text-white py-2 font-medium disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send message"}
          </button>
        </form>
      </div>
    </div>
  );
}