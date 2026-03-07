"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Bot,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CreditCard,
  FileText,
  Mail,
  MessageSquare,
  Rocket,
  Shield,
  Sparkles,
  X,
} from "lucide-react";

type TabKey = "overview" | "notifications";

type OnboardingProgress = {
  created_first_bot: boolean;
  uploaded_first_doc: boolean;
  sent_first_chat: boolean;
  opened_schedule: boolean;
  connected_gmail: boolean;
  summarized_inbox: boolean;
  completed_steps: number;
  total_steps: number;
  percent: number;
};

type OnboardingStats = {
  bots_count: number;
  documents_count: number;
  plan: string;
  schedule_enabled: boolean;
  email_enabled: boolean;
  onboarding: OnboardingProgress;
};

type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  href: string;
  action: string;
  hint: string;
};

const EMPTY_PROGRESS: OnboardingProgress = {
  created_first_bot: false,
  uploaded_first_doc: false,
  sent_first_chat: false,
  opened_schedule: false,
  connected_gmail: false,
  summarized_inbox: false,
  completed_steps: 0,
  total_steps: 4,
  percent: 0,
};

const STORAGE_COMPLETED = "louisai_onboarding_completed";
const STORAGE_SUCCESS_DISMISSED = "louisai_onboarding_success_dismissed";

function isNewWorkspace(s: OnboardingStats | null) {
  if (!s) return false;
  return Number(s?.onboarding?.completed_steps ?? 0) < Number(s?.onboarding?.total_steps ?? 0);
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

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5">
          {item.done ? (
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border bg-primary/10 text-primary">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          ) : (
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
              <CircleDashed className="h-4 w-4" />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-sm font-medium">{item.label}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.hint}</div>
        </div>
      </div>

      <Link
        href={item.href}
        className={[
          "shrink-0 rounded-xl px-3 py-2 text-sm transition-all duration-200",
          item.done
            ? "border bg-background/60 backdrop-blur hover:-translate-y-[1px] hover:bg-accent"
            : "bg-primary text-primary-foreground hover:-translate-y-[1px] hover:opacity-95",
        ].join(" ")}
      >
        {item.action}
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [stats, setStats] = useState<OnboardingStats | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);

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
            email_enabled: !!j?.email_enabled,
            onboarding: {
              created_first_bot: !!j?.onboarding?.created_first_bot,
              uploaded_first_doc: !!j?.onboarding?.uploaded_first_doc,
              sent_first_chat: !!j?.onboarding?.sent_first_chat,
              opened_schedule: !!j?.onboarding?.opened_schedule,
              connected_gmail: !!j?.onboarding?.connected_gmail,
              summarized_inbox: !!j?.onboarding?.summarized_inbox,
              completed_steps: Number(j?.onboarding?.completed_steps ?? 0),
              total_steps: Number(j?.onboarding?.total_steps ?? 4),
              percent: Number(j?.onboarding?.percent ?? 0),
            },
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const completed = window.localStorage.getItem(STORAGE_COMPLETED) === "1";
    const dismissed = window.localStorage.getItem(STORAGE_SUCCESS_DISMISSED) === "1";

    if (completed && !dismissed) {
      setShowSuccessBanner(true);
    }
  }, []);

  const progress = stats?.onboarding ?? EMPTY_PROGRESS;
  const showOnboarding = isNewWorkspace(stats);

  const checklist = useMemo<ChecklistItem[]>(() => {
    const scheduleEnabled = !!stats?.schedule_enabled;
    const emailEnabled = !!stats?.email_enabled;

    const items: ChecklistItem[] = [
      {
        id: "bot",
        label: progress.created_first_bot ? "Bot created" : "Create your first bot",
        done: progress.created_first_bot,
        href: "/app/bots",
        action: progress.created_first_bot ? "Manage" : "Create bot",
        hint: progress.created_first_bot
          ? "Your workspace has a bot ready."
          : "Start with one bot so your workspace has a dedicated AI assistant.",
      },
      {
        id: "docs",
        label: progress.uploaded_first_doc ? "Document uploaded" : "Upload your first document",
        done: progress.uploaded_first_doc,
        href: "/app/docs",
        action: progress.uploaded_first_doc ? "Open docs" : "Upload",
        hint: progress.uploaded_first_doc
          ? "Your knowledge base already has uploaded content."
          : "Upload SOPs, onboarding docs, pricing, proposals, or internal notes.",
      },
      {
        id: "chat",
        label: progress.sent_first_chat ? "First chat sent" : "Ask your first question in chat",
        done: progress.sent_first_chat,
        href: "/app/chat",
        action: progress.sent_first_chat ? "Open chat" : "Start chat",
        hint: progress.sent_first_chat
          ? "You’ve already started using Louis in chat."
          : "Ask Louis to summarize what it knows or answer an internal question.",
      },
      {
        id: "schedule",
        label: scheduleEnabled
          ? progress.opened_schedule
            ? "Schedule opened"
            : "Open schedule"
          : "Unlock schedule extraction",
        done: scheduleEnabled ? progress.opened_schedule : false,
        href: scheduleEnabled ? "/app/schedule" : "/app/billing",
        action: scheduleEnabled ? "Open schedule" : "Upgrade",
        hint: scheduleEnabled
          ? progress.opened_schedule
            ? "Your schedule workspace is active."
            : "Open schedule to review events, tasks, and extracted workflow items."
          : "Upgrade to enable extraction-driven schedule and task workflows.",
      },
    ];

    if (emailEnabled) {
      items.push({
        id: "gmail",
        label: progress.connected_gmail ? "Gmail connected" : "Connect Gmail",
        done: progress.connected_gmail,
        href: "/app/email",
        action: progress.connected_gmail ? "Open email" : "Connect",
        hint: progress.connected_gmail
          ? "Your Gmail integration is connected."
          : "Connect Gmail to unlock inbox summaries and email workflows.",
      });

      items.push({
        id: "summarized_inbox",
        label: progress.summarized_inbox ? "Inbox summarized" : "Summarize your inbox",
        done: progress.summarized_inbox,
        href: "/app/email",
        action: "Open email",
        hint: progress.summarized_inbox
          ? "You’ve already used inbox summarization."
          : "Open Email and run an inbox summary to finish the email onboarding flow.",
      });
    }

    return items;
  }, [stats, progress]);

  const completedChecklistCount = Number(progress.completed_steps ?? 0);
  const checklistPercent = Number(progress.percent ?? 0);

  function dismissSuccessBanner() {
    setShowSuccessBanner(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_SUCCESS_DISMISSED, "1");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {showSuccessBanner ? (
        <div className="relative overflow-hidden rounded-[28px] border bg-card/80 p-6 shadow-sm backdrop-blur md:p-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_320px_at_0%_0%,hsl(var(--primary)/0.10),transparent_55%),radial-gradient(700px_280px_at_100%_0%,hsl(var(--accent)/0.12),transparent_50%)]" />

          <div className="relative flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border bg-background/65 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  You’re all set
                </div>

                <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
                  Onboarding complete. Your workspace is ready.
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                  You’ve finished the guided setup. Now jump straight into the workflows that matter most.
                </p>
              </div>

              <button
                type="button"
                onClick={dismissSuccessBanner}
                className="rounded-xl border border-white/10 p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="Dismiss success banner"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/app/chat"
                className="inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:-translate-y-[1px] hover:opacity-95"
              >
                Open Chat
              </Link>

              <Link
                href="/app/docs"
                className="inline-flex items-center justify-center rounded-2xl border bg-background/60 px-4 py-3 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
              >
                Upload Docs
              </Link>

              <Link
                href="/app/schedule"
                className="inline-flex items-center justify-center rounded-2xl border bg-background/60 px-4 py-3 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
              >
                Open Schedule
              </Link>
            </div>
          </div>
        </div>
      ) : null}

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

      <div className="rounded-[28px] border bg-card/75 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Brain className="h-3.5 w-3.5" />
              Agency Brain
            </div>
            <div className="mt-3 text-lg font-medium tracking-tight">Open the shared intelligence layer for your agency.</div>
            <div className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Use Agency Brain as the central place for shared knowledge, private context, documents, schedule activity,
              and inbox-driven workflows.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/brain"
              className="inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:-translate-y-[1px] hover:opacity-95"
            >
              Open Agency Brain
            </Link>
            <Link
              href="/app/docs"
              className="inline-flex items-center justify-center rounded-2xl border bg-background/60 px-4 py-3 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
            >
              Add knowledge
            </Link>
          </div>
        </div>
      </div>

      {showOnboarding ? (
        <div className="rounded-[28px] border bg-card/75 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Rocket className="h-3.5 w-3.5" />
                Onboarding checklist
              </div>
              <div className="mt-3 text-lg font-medium tracking-tight">Set up your workspace once, then move fast.</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Finish these first actions to make Louis useful immediately.
              </div>
            </div>

            <div className="min-w-[180px]">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {completedChecklistCount} of {progress.total_steps} done
                </span>
                <span>{checklistPercent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${checklistPercent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {checklist.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
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
              title={stats?.schedule_enabled ? "Open schedule" : "Unlock extraction"}
              body={
                stats?.schedule_enabled
                  ? "Review your schedule, events, and tasks after extraction."
                  : "Upgrade to unlock task and event extraction from documents."
              }
              primaryHref={stats?.schedule_enabled ? "/app/schedule" : "/app/billing"}
              primaryLabel={stats?.schedule_enabled ? "Open Schedule" : "Upgrade"}
              secondaryHref={stats?.schedule_enabled ? "/app/chat" : "/app/schedule"}
              secondaryLabel={stats?.schedule_enabled ? "Go to Chat" : "Preview Schedule"}
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
            href="/app/brain"
            className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
          >
            Brain
          </Link>
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
                href="/app/brain"
                icon={<Brain className="h-4 w-4" />}
                title="Open Agency Brain"
                desc="Go to the shared intelligence layer for your whole agency."
              />
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
                    <Brain className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Use Agency Brain as your command center</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Centralize docs, bots, schedule activity, and email workflows in one shared workspace view.
                    </div>
                    <div className="mt-3">
                      <Link
                        href="/app/brain"
                        className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                      >
                        Open Agency Brain
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              {!progress.uploaded_first_doc ? (
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
              ) : null}

              {!progress.sent_first_chat ? (
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
              ) : null}

              {stats?.schedule_enabled && !progress.opened_schedule ? (
                <div className="rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
                      <CalendarDays className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">Open schedule</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Review extracted tasks and events in your schedule workspace.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href="/app/schedule"
                          className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                        >
                          Open Schedule
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {!stats?.schedule_enabled ? (
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
                          href="/app/billing"
                          className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                        >
                          Upgrade
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {stats?.email_enabled && !progress.connected_gmail ? (
                <div className="rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">Connect Gmail</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Unlock inbox summaries and email workflows by connecting Gmail.
                      </div>
                      <div className="mt-3">
                        <Link
                          href="/app/email"
                          className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                        >
                          Open Email
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {stats?.email_enabled && progress.connected_gmail && !progress.summarized_inbox ? (
                <div className="rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-background/70 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">Summarize your inbox</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Run an inbox summary to finish the email onboarding flow.
                      </div>
                      <div className="mt-3">
                        <Link
                          href="/app/email"
                          className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition-all duration-200 hover:-translate-y-[1px] hover:bg-accent"
                        >
                          Open Email
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {progress.completed_steps >= progress.total_steps ? (
                <div className="rounded-2xl border bg-background/45 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-primary/10 text-primary">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">Onboarding complete</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Your workspace is set up and ready for normal daily use.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
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