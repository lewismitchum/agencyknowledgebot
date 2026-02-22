// app/(app)/app/support/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

async function safeJson(r: Response) {
  return await r.json().catch(async () => {
    const t = await r.text().catch(() => "");
    return { _raw: t };
  });
}

export default function SupportPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canSend = useMemo(() => message.trim().length > 0 && !loading, [message, loading]);

  async function submit() {
    if (!canSend) return;
    setLoading(true);
    setOk(null);
    setErr(null);

    try {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          pageUrl: typeof window !== "undefined" ? window.location.href : "",
        }),
      });

      const j: any = await safeJson(r);

      if (!r.ok || j?.ok === false) {
        setErr(String(j?.error ?? j?.message ?? `Failed (${r.status})`));
        return;
      }

      const sent = Boolean(j?.email_sent);
      setOk(sent ? "Support request sent." : "Support request received (email delivery unavailable).");
      setMessage("");
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Network error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl">Support</CardTitle>
          <CardDescription>Send a message to the Louis.Ai team.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {ok ? <div className="text-sm text-emerald-600">{ok}</div> : null}
          {err ? <div className="text-sm text-destructive">{err}</div> : null}

          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground">Name (optional)</label>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground">Email (optional)</label>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground">Message</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what happened…"
              rows={7}
            />
          </div>

          <Button onClick={submit} disabled={!canSend}>
            {loading ? "Sending…" : "Send"}
          </Button>

          <div className="text-xs text-muted-foreground">
            Back to{" "}
            <Link className="underline" href="/chat">
              Chat
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}