"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Headphones, LifeBuoy, Mail, MessageSquareWarning, Send, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type SupportResp =
  | { ok: true; ticket_id?: string; id?: string }
  | { ok?: false; error?: string; message?: string };

function TopStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border bg-background/80 p-5 shadow-sm transition hover:-translate-y-[2px] hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
          <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
        </div>

        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-muted/30 text-muted-foreground shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function SupportPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string>("");
  const [error, setError] = useState<string>("");

  const canSubmit = useMemo(() => {
    return subject.trim().length >= 3 && message.trim().length >= 10 && !busy;
  }, [subject, message, busy]);

  const subjectCount = subject.trim().length;
  const messageCount = message.trim().length;

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
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8" data-tour="support-main">
      <section className="relative overflow-hidden rounded-[32px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.10),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Support
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">
              Get help fast without leaving the workspace.
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Send a message to the Louis.Ai team for bugs, billing questions, upload issues,
              access problems, or anything blocking your agency.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded-full px-3 py-1">
                Email reply support
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Workspace ticket stored
              </Badge>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[260px]">
            <Button asChild variant="outline" className="h-11 rounded-2xl">
              <Link href="/app">
                Back to dashboard
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-2xl">
              <Link href="/app/usage">Usage</Link>
            </Button>
          </div>
        </div>
      </section>

      {toast ? (
        <Card className="overflow-hidden rounded-[28px] border shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-emerald-50 px-6 py-4 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
              <div className="text-sm font-semibold">Ticket sent</div>
              <div className="mt-1 text-sm opacity-90">{toast}</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="overflow-hidden rounded-[28px] border shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-red-50 px-6 py-4 text-red-900 dark:bg-red-950/20 dark:text-red-100">
              <div className="text-sm font-semibold">Could not send ticket</div>
              <div className="mt-1 text-sm opacity-90">{error}</div>
            </div>
            <div className="flex flex-wrap gap-3 p-6">
              <Button className="rounded-full" onClick={submit} disabled={!canSubmit || busy}>
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TopStat
          icon={<Headphones className="h-5 w-5" />}
          label="Support channel"
          value="Email"
          hint="We reply to the account email"
        />
        <TopStat
          icon={<LifeBuoy className="h-5 w-5" />}
          label="Ticket storage"
          value="Saved"
          hint="Stored in your workspace"
        />
        <TopStat
          icon={<Mail className="h-5 w-5" />}
          label="Contact"
          value="Direct"
          hint="support@letsalterminds.org"
        />
        <TopStat
          icon={<MessageSquareWarning className="h-5 w-5" />}
          label="Best reports"
          value="Detailed"
          hint="Include steps and error text"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">Create a support ticket</CardTitle>
            <CardDescription className="mt-2">
              Tell us what happened, what you expected, and any visible error text.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="rounded-3xl border bg-muted/25 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">Subject</div>
                  <div className="text-xs text-muted-foreground">{subjectCount}/3 min</div>
                </div>

                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Upload failed, billing question, bug report..."
                  className="h-11 w-full rounded-2xl border bg-background px-4 text-sm outline-none ring-0 transition focus:border-foreground/20 focus:ring-2 focus:ring-ring"
                  disabled={busy}
                />
              </div>
            </div>

            <div className="rounded-3xl border bg-muted/25 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">Message</div>
                  <div className="text-xs text-muted-foreground">{messageCount}/10 min</div>
                </div>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What happened? What did you expect? Any error text? What page were you on?"
                  className="min-h-[180px] w-full rounded-2xl border bg-background px-4 py-3 text-sm outline-none ring-0 transition focus:border-foreground/20 focus:ring-2 focus:ring-ring"
                  disabled={busy}
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-3xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                We automatically attach lightweight client context like the current page and browser.
              </div>

              <Button className="rounded-full px-5" onClick={submit} disabled={!canSubmit}>
                <Send className="mr-2 h-4 w-4" />
                {busy ? "Sending..." : "Send ticket"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">Before you send</CardTitle>
            <CardDescription className="mt-2">
              These details help us solve problems much faster.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Best bug report format</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Include what page you were on, what you clicked, what happened, and what you expected instead.
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Useful extras</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Paste exact error text, mention the bot involved, and note whether the problem is blocking your team.
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-4 shadow-sm">
              <div className="text-sm font-semibold">Billing help</div>
              <div className="mt-2 text-sm text-muted-foreground">
                For plan questions, renewals, or upgrade issues, include the workspace plan you expected to be on.
              </div>
            </div>

            <div className="rounded-3xl border bg-muted/25 p-4">
              <div className="text-sm font-semibold">Emergency contact</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Email us directly at{" "}
                <span className="font-medium text-foreground">support@letsalterminds.org</span>.
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild className="rounded-full">
                  <Link href="/app/billing">Billing</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/app/usage">Usage</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/app/docs">Docs</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}