"use client";

import Link from "next/link";

export default function OutreachPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Outreach</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Standalone outreach workspace for lead generation, campaign management, and email automation.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border bg-card p-6 shadow-sm lg:col-span-2">
          <div className="text-base font-semibold">Lead generation</div>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is now reserved for outreach only. Lead finding, campaign creation, email drafting, and send
            automation should live here instead of inside spreadsheets.
          </p>

          <div className="mt-4 rounded-2xl border bg-background/40 p-4 text-sm text-muted-foreground">
            Next step: move the lead finder and campaign UI from <span className="font-mono">/app/spreadsheets</span>{" "}
            into this page.
          </div>
        </div>

        <div className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="text-base font-semibold">Quick links</div>

          <div className="mt-4 space-y-3">
            <Link
              href="/app/spreadsheets"
              className="block rounded-xl border px-4 py-3 text-sm transition hover:bg-muted"
            >
              Open Spreadsheets
            </Link>

            <Link
              href="/app/email"
              className="block rounded-xl border px-4 py-3 text-sm transition hover:bg-muted"
            >
              Open Email
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}