// app/(app)/app/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TabKey = "overview" | "notifications";

type OnboardingStats = {
  bots_count: number;
  documents_count: number;
  plan: string;
  schedule_enabled: boolean;
};

function isNewWorkspace(s: OnboardingStats | null) {
  if (!s) return false;
  return (Number(s.bots_count) || 0) <= 0 || (Number(s.documents_count) || 0) <= 0;
}

export default function DashboardPage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [stats, setStats] = useState<OnboardingStats | null>(null);

  const tabs = useMemo(
    () =>
      [
        { key: "overview" as const, label: "Overview" },
        { key: "notifications" as const, label: "Notifications" },
      ] as const,
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch("/api/onboarding", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok) return;

        if (!cancelled) {
          setStats({
            bots_count: Number(j?.bots_count ?? 0),
            documents_count: Number(j?.documents_count ?? 0),
            plan: String(j?.plan ?? "free"),
            schedule_enabled: !!j?.schedule_enabled,
          });
        }
      } catch {
        // non-fatal
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const showOnboarding = isNewWorkspace(stats);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Your workspace — built for real agency knowledge.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Upload docs, chat with your internal knowledge, and extract tasks + events into Schedule.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border bg-muted/30 px-3 py-1">Secure multi-tenant isolation</span>
              <span className="rounded-full border bg-muted/30 px-3 py-1">Docs-first answers</span>
              <span className="rounded-full border bg-muted/30 px-3 py-1">Schedule extraction (paid)</span>
              <span className="rounded-full border bg-muted/30 px-3 py-1">Auto memory refresh</span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[260px]">
            <Link
              href="/app/docs"
              className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Upload documents
            </Link>
            <Link
              href="/app/chat"
              className="inline-flex w-full items-center justify-center rounded-xl border px-4 py-2.5 text-sm hover:bg-accent"
            >
              Open chat
            </Link>
            <div className="text-center text-[11px] text-muted-foreground">
              Tip: Upload first → better answers immediately.
            </div>
          </div>
        </div>
      </div>

      {showOnboarding ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium">Getting started</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Do this once and your workspace becomes instantly useful.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/app/bots" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                Create a bot
              </Link>
              <Link href="/app/docs" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                Upload docs
              </Link>
              <Link href="/app/chat" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                Ask questions
              </Link>
              <Link href="/app/schedule" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                Schedule
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border bg-background/40 p-4">
              <div className="text-sm font-medium">1) Create a bot</div>
              <div className="mt-1 text-xs text-muted-foreground">Agency bots are shared. Private bots are personal.</div>
              <div className="mt-3">
                <Link href="/app/bots" className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                  Go to Bots
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border bg-background/40 p-4">
              <div className="text-sm font-medium">2) Upload docs</div>
              <div className="mt-1 text-xs text-muted-foreground">
                SOPs, onboarding, proposals — Louis grounds internal answers in your uploads.
              </div>
              <div className="mt-3">
                <Link href="/app/docs" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                  Go to Docs
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border bg-background/40 p-4">
              <div className="text-sm font-medium">3) Extract tasks + events (Starter+)</div>
              <div className="mt-1 text-xs text-muted-foreground">Turn messy docs into a clean schedule in seconds.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/app/schedule" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                  Open Schedule
                </Link>
                <Link href="/app/billing" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                  Upgrade
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-4 text-xs text-muted-foreground">
            Current: bots {stats?.bots_count ?? "—"} • docs {stats?.documents_count ?? "—"} • plan{" "}
            {stats?.plan ?? "—"}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "rounded-xl px-3 py-2 text-sm transition-colors",
              tab === t.key
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link href="/app/usage" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
            Usage
          </Link>
          <Link href="/app/chat" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
            Chat
          </Link>
          <Link href="/app/docs" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
            Docs
          </Link>
          <Link href="/app/schedule" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
            Schedule
          </Link>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Quick links</div>
                <div className="mt-1 text-xs text-muted-foreground">Jump straight into the core flows.</div>
              </div>
              <Link href="/app/support" className="rounded-xl border px-3 py-2 text-xs hover:bg-accent">
                Support
              </Link>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/docs">
                Upload / Manage Docs
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/chat">
                Ask the Knowledge Bot
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/schedule">
                View Schedule
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/bots">
                Manage Bots
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/usage">
                Usage / Limits
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/billing">
                Billing / Upgrade
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="text-sm font-medium">What to do next</div>
            <div className="mt-2 text-sm text-muted-foreground">
              If your workspace is brand new, do this once and you’re flying.
            </div>

            <div className="mt-4 space-y-2">
              <div className="rounded-2xl border bg-background/40 p-4">
                <div className="text-sm font-medium">1) Upload a doc</div>
                <div className="mt-1 text-xs text-muted-foreground">PDFs, DOCX, TXT — Louis learns from what you upload.</div>
                <div className="mt-3">
                  <Link href="/app/docs" className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                    Go to Docs
                  </Link>
                </div>
              </div>

              <div className="rounded-2xl border bg-background/40 p-4">
                <div className="text-sm font-medium">2) Ask questions in Chat</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Get docs-backed internal answers, plus general reasoning when appropriate.
                </div>
                <div className="mt-3">
                  <Link href="/app/chat" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                    Go to Chat
                  </Link>
                </div>
              </div>

              <div className="rounded-2xl border bg-background/40 p-4">
                <div className="text-sm font-medium">3) Extract tasks + events (Starter+)</div>
                <div className="mt-1 text-xs text-muted-foreground">Turn messy documents into a clean schedule in seconds.</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/app/schedule" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                    Open Schedule
                  </Link>
                  <Link href="/app/billing" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                    Upgrade
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Notifications</div>
              <div className="mt-2 text-sm text-muted-foreground">
                View schedule reminders, extraction outcomes, and account notices.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/notifications">
                Open
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/schedule">
                Schedule
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/support">
                Support
              </Link>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border bg-muted p-4 text-sm text-muted-foreground">
            Go to the full Notifications page.
          </div>
        </div>
      )}
    </div>
  );
}