// app/(app)/app/support/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type SupportResp =
  | { ok: true; ticket_id?: string; id?: string }
  | { ok?: false; error?: string; message?: string };

export default function SupportPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string>("");
  const [error, setError] = useState<string>("");

  const canSubmit = useMemo(() => {
    return subject.trim().length >= 3 && message.trim().length >= 10 && !busy;
  }, [subject, message, busy]);

  function showToast(s: string) {
    setToast(s);
    window.setTimeout(() => setToast(""), 3500);
  }

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setError("");

    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          // optional: add some lightweight client context
          page: typeof window !== "undefined" ? window.location.pathname : "",
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = (await r.json().catch(() => null)) as SupportResp | null;

      if (!r.ok || !j?.ok) {
        throw new Error(String((j as any)?.error || (j as any)?.message || `Failed (${r.status})`));
      }

      setSubject("");
      setMessage("");
      showToast("Support ticket sent.");
    } catch (e: any) {
      setError(e?.message || "Failed to send support ticket");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
          <p className="mt-2 text-muted-foreground">
            Send a message to the Louis.Ai team. We’ll reply by email.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/app">Back to dashboard</Link>
          </Button>
        </div>
      </div>

      {toast ? (
        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Sent</div>
          <div className="mt-1 text-muted-foreground">{toast}</div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Create a ticket</CardTitle>
          <CardDescription>Include steps to reproduce if something is broken.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Subject</div>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Upload failed, billing question, bug report…"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Message</div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened? What did you expect? Any error text?"
              className="min-h-[160px] w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              We store this as a support ticket in your workspace.
            </div>
            <Button className="rounded-full" onClick={submit} disabled={!canSubmit}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>

          <div className="rounded-2xl border bg-muted p-4 text-sm text-muted-foreground">
            Emergency? Email us at <span className="font-mono">support@letsalterminds.org</span>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}