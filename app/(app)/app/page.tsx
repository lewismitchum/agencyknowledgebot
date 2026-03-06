// app/(app)/app/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Bot,
  CalendarDays,
  ChevronRight,
  CreditCard,
  FileText,
  MessageSquare,
  Rocket,
  Shield,
  Sparkles,
} from "lucide-react";

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

function StatCard({
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
    <div className="rounded-3xl border bg-card/75 p-5 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-[2px] hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
          <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
        </div>

        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
}

function ActionLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border bg-background/50 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:bg-accent/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
          {icon}
        </div>
        <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
      </div>

      <div className="mt-4 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </Link>
  );
}

function StepCard({
  step,
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  icon,
}: {
  step: string;
  title: string;
  body: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border bg-background/45 p-5 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground shadow-sm">
          {icon}
        </div>
        <div className="rounded-full border bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {step}
        </div>
      </div>

      <div className="mt-4 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{body}</div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={primaryHref}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-all duration-200 hover:-translate-y-[1px] hover:opacity-95"
        >
          {primaryLabel}
        </Link>

        {secondaryHref && secondaryLabel ? (
          <Link
            href={secondaryHref}
            className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
          >
            {secondaryLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
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
      <div className="relative overflow-hidden rounded-[28px] border bg-card/80 p-6 shadow-sm backdrop-blur md:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.12),transparent_50%)]" />

        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/65 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Agency Knowledge OS
            </div>

            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
              Your workspace, built for real agency knowledge.
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Upload docs, chat with your internal knowledge, and turn documents into tasks + events with a cleaner,
              faster workflow.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border bg-background/60 px-3 py-1 backdrop-blur">
                Secure multi-tenant isolation
              </span>
              <span className="rounded-full border bg-background/60 px-3 py-1 backdrop-blur">Docs-first answers</span>
              <span className="rounded-full border bg-background/60 px-3 py-1 backdrop-blur">
                Schedule extraction (paid)
              </span>
              <span className="rounded-full border bg-background/60 px-3 py-1 backdrop-blur">Auto memory refresh</span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[280px]">
            <Link
              href="/app/docs"
              className="inline-flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:-translate-y-[1px] hover:opacity-95"
            >
              Upload documents
            </Link>
            <Link
              href="/app/chat"
              className="inline-flex w-full items-center justify-center rounded-2xl border bg-background/60 px-4 py-3 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
            >
              Open chat
            </Link>
            <div className="text-center text-[11px] text-muted-foreground">
              Tip: upload first, then chat for better answers immediately.
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          icon={<Bot className="h-5 w-5" />}
          label="Bots"
          value={String(stats?.bots_count ?? "—")}
          hint="Shared and private assistants"
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Documents"
          value={String(stats?.documents_count ?? "—")}
          hint="Knowledge uploaded to workspace"
        />
        <StatCard
          icon={<CreditCard className="h-5 w-5" />}
          label="Plan"
          value={String(stats?.plan ?? "—")}
          hint="Current billing tier"
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5" />}
          label="Schedule"
          value={stats?.schedule_enabled ? "On" : "Off"}
          hint={stats?.schedule_enabled ? "Extraction enabled" : "Upgrade to unlock extraction"}
        />
      </div>

      {showOnboarding ? (
        <div className="rounded-[28px] border bg-card/75 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Rocket className="h-3.5 w-3.5" />
                Getting started
              </div>
              <div className="mt-3 text-lg font-medium tracking-tight">Set up your workspace once, then move fast.</div>
              <div className="mt-1 text-sm text-muted-foreground">
                These are the first actions that make Louis instantly useful.
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Current: bots {stats?.bots_count ?? "—"} • docs {stats?.documents_count ?? "—"} • plan{" "}
              {stats?.plan ?? "—"}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <StepCard
              step="Step 1"
              title="Create a bot"
              body="Agency bots are shared across your workspace. Private bots stay personal to the user."
              primaryHref="/app/bots"
              primaryLabel="Go to Bots"
              icon={<Bot className="h-5 w-5" />}
            />

            <StepCard
              step="Step 2"
              title="Upload documents"
              body="SOPs, onboarding, proposals, pricing sheets — Louis grounds internal answers in uploaded content."
              primaryHref="/app/docs"
              primaryLabel="Go to Docs"
              icon={<FileText className="h-5 w-5" />}
            />

            <StepCard
              step="Step 3"
              title="Extract tasks + events"
              body="Turn messy docs into a clean schedule and task flow when your plan includes extraction."
              primaryHref="/app/schedule"
              primaryLabel="Open Schedule"
              secondaryHref="/app/billing"
              secondaryLabel="Upgrade"
              icon={<CalendarDays className="h-5 w-5" />}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/75 p-2 shadow-sm backdrop-blur">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "rounded-xl px-3 py-2 text-sm transition-all duration-200",
              tab === t.key
                ? "bg-accent text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href="/app/usage"
            className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
          >
            Usage
          </Link>
          <Link
            href="/app/chat"
            className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
          >
            Chat
          </Link>
          <Link
            href="/app/docs"
            className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
          >
            Docs
          </Link>
          <Link
            href="/app/schedule"
            className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
          >
            Schedule
          </Link>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[28px] border bg-card/75 p-5 shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Quick actions</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Jump straight into the workflows that matter most.
                </div>
              </div>

              <Link
                href="/app/support"
                className="rounded-xl border bg-background/60 px-3 py-2 text-xs backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
              >
                Support
              </Link>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ActionLink
                href="/app/docs"
                icon={<FileText className="h-4 w-4" />}
                title="Upload / Manage Docs"
                desc="Add and manage the knowledge your workspace runs on."
              />
              <ActionLink
                href="/app/chat"
                icon={<MessageSquare className="h-4 w-4" />}
                title="Ask the Knowledge Bot"
                desc="Get answers grounded in your internal docs."
              />
              <ActionLink
                href="/app/schedule"
                icon={<CalendarDays className="h-4 w-4" />}
                title="View Schedule"
                desc="See extracted events and tasks in one place."
              />
              <ActionLink
                href="/app/bots"
                icon={<Bot className="h-4 w-4" />}
                title="Manage Bots"
                desc="Organize shared and private assistants."
              />
              <ActionLink
                href="/app/usage"
                icon={<Shield className="h-4 w-4" />}
                title="Usage / Limits"
                desc="Track limits, uploads, and availability."
              />
              <ActionLink
                href="/app/billing"
                icon={<CreditCard className="h-4 w-4" />}
                title="Billing / Upgrade"
                desc="Unlock schedule, media, and premium workflows."
              />
            </div>
          </div>

          <div className="rounded-[28px] border bg-card/75 p-5 shadow-sm backdrop-blur">
            <div className="text-sm font-medium">Recommended next moves</div>
            <div className="mt-2 text-sm text-muted-foreground">
              If your workspace is still early, these are the highest-impact actions.
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Upload a core document</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      PDFs, DOCX, and TXT files help Louis answer internal questions with stronger grounding.
                    </div>
                    <div className="mt-3">
                      <Link
                        href="/app/docs"
                        className="inline-flex items-center justify-center rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground transition-all duration-200 hover:-translate-y-[1px] hover:opacity-95"
                      >
                        Go to Docs
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Start asking questions in Chat</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Use chat for internal knowledge, utility questions, and follow-up reasoning.
                    </div>
                    <div className="mt-3">
                      <Link
                        href="/app/chat"
                        className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                      >
                        Go to Chat
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Turn docs into schedule items</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Paid plans can extract tasks and events directly into Schedule.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href="/app/schedule"
                        className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                      >
                        Open Schedule
                      </Link>
                      <Link
                        href="/app/billing"
                        className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                      >
                        Upgrade
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[28px] border bg-card/75 p-5 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Bell className="h-3.5 w-3.5" />
                Notifications
              </div>
              <div className="mt-3 text-lg font-medium tracking-tight">Stay on top of reminders and workspace events.</div>
              <div className="mt-2 text-sm text-muted-foreground">
                View schedule reminders, extraction outcomes, and account notices from one place.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                href="/app/notifications"
              >
                Open
              </Link>
              <Link
                className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                href="/app/schedule"
              >
                Schedule
              </Link>
              <Link
                className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                href="/app/support"
              >
                Support
              </Link>
            </div>
          </div>

          <div className="mt-5 rounded-3xl border bg-background/45 p-5">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
                <Bell className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium">Open the full Notifications page</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Review reminders, extraction results, and account notices in the dedicated view.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}