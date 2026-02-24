// app/(app)/app/page.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type TabKey = "overview" | "notifications";

export default function DashboardPage() {
  const [tab, setTab] = useState<TabKey>("overview");

  const tabs = useMemo(
    () =>
      [
        { key: "overview" as const, label: "Overview" },
        { key: "notifications" as const, label: "Notifications" },
      ] as const,
    []
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Quick access to your workspace.</p>
      </div>

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
            Open Chat
          </Link>
          <Link href="/app/docs" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
            Open Docs
          </Link>
          <Link href="/app/schedule" className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
            Open Schedule
          </Link>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="text-sm font-medium">Quick links</div>
            <div className="mt-3 grid gap-2">
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/chat">
                Chat
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/docs">
                Docs
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/bots">
                Bots
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/schedule">
                Schedule
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/usage">
                Usage
              </Link>
              <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/support">
                Support
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="text-sm font-medium">Notifications</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Notifications UI lives here (tab), not a separate page route.
            </div>
            <div className="mt-4 rounded-2xl border bg-muted p-4 text-sm text-muted-foreground">
              Coming next: show schedule reminders, extraction outcomes, and account/billing notices here.
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-sm font-medium">Notifications</div>
          <div className="mt-2 text-sm text-muted-foreground">This is the notifications tab on the dashboard.</div>

          <div className="mt-4 rounded-2xl border bg-muted p-4 text-sm text-muted-foreground">No notifications yet.</div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/schedule">
              Go to Schedule
            </Link>
            <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/usage">
              View Usage
            </Link>
            <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" href="/app/support">
              Contact Support
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}