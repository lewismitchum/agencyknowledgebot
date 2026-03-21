"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  FileText,
  Rocket,
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-3xl border bg-card/75 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
        </div>
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-background text-muted-foreground">
          {icon}
        </div>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border bg-background p-4 transition hover:-translate-y-[1px] hover:bg-accent"
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </Link>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-background p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div>
          {item.done ? (
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border bg-primary/10 text-primary">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          ) : (
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border bg-background text-muted-foreground">
              <Rocket className="h-4 w-4" />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-sm font-medium">{item.label}</div>
        </div>
      </div>

      <Link
        href={item.href}
        className={[
          "shrink-0 rounded-xl px-3 py-2 text-sm transition",
          item.done
            ? "border bg-background hover:bg-accent"
            : "bg-primary text-primary-foreground hover:opacity-95",
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
    if (completed && !dismissed) setShowSuccessBanner(true);
  }, []);

  const progress = stats?.onboarding ?? EMPTY_PROGRESS;
  const showOnboarding = isNewWorkspace(stats);

  const hero = useMemo(() => {
    if (!stats) {
      return {
        title: "Get started",
        body: "Open your workspace and take the next step.",
        href: "/app/docs",
        action: "Open docs",
      };
    }

    if (!progress.created_first_bot) {
      return {
        title: "Create your first bot",
        body: "Start with one bot for your workspace.",
        href: "/app/bots",
        action: "Create bot",
      };
    }

    if (!progress.uploaded_first_doc) {
      return {
        title: "Upload your first document",
        body: "Give Louis knowledge before you start chatting.",
        href: "/app/docs",
        action: "Upload document",
      };
    }

    if (!progress.sent_first_chat) {
      return {
        title: "Ask your first question",
        body: "Start using your uploaded knowledge in chat.",
        href: "/app/chat",
        action: "Open chat",
      };
    }

    if (stats.schedule_enabled && !progress.opened_schedule) {
      return {
        title: "Open schedule",
        body: "Review tasks and events routed from your workspace.",
        href: "/app/schedule",
        action: "Open schedule",
      };
    }

    if (stats.email_enabled && !progress.connected_gmail) {
      return {
        title: "Connect Gmail",
        body: "Unlock inbox and sending workflows.",
        href: "/app/email",
        action: "Open email",
      };
    }

    if (stats.email_enabled && progress.connected_gmail && !progress.summarized_inbox) {
      return {
        title: "Summarize your inbox",
        body: "Finish email setup with your first inbox summary.",
        href: "/app/email",
        action: "Open email",
      };
    }

    return {
      title: "Welcome back",
      body: "Your workspace is ready. Pick up where you left off.",
      href: "/app/chat",
      action: "Open chat",
    };
  }, [stats, progress]);

  const checklist = useMemo<ChecklistItem[]>(() => {
    const items: ChecklistItem[] = [
      {
        id: "bot",
        label: progress.created_first_bot ? "Bot created" : "Create your first bot",
        done: progress.created_first_bot,
        href: "/app/bots",
        action: progress.created_first_bot ? "Open" : "Create",
      },
      {
        id: "docs",
        label: progress.uploaded_first_doc ? "Document uploaded" : "Upload your first document",
        done: progress.uploaded_first_doc,
        href: "/app/docs",
        action: progress.uploaded_first_doc ? "Open" : "Upload",
      },
      {
        id: "chat",
        label: progress.sent_first_chat ? "First chat sent" : "Ask your first question",
        done: progress.sent_first_chat,
        href: "/app/chat",
        action: progress.sent_first_chat ? "Open" : "Start",
      },
    ];

    if (stats?.schedule_enabled) {
      items.push({
        id: "schedule",
        label: progress.opened_schedule ? "Schedule opened" : "Open schedule",
        done: progress.opened_schedule,
        href: "/app/schedule",
        action: "Open",
      });
    } else {
      items.push({
        id: "schedule-upgrade",
        label: "Unlock schedule",
        done: false,
        href: "/app/billing",
        action: "Upgrade",
      });
    }

    if (stats?.email_enabled) {
      items.push({
        id: "gmail",
        label: progress.connected_gmail ? "Gmail connected" : "Connect Gmail",
        done: progress.connected_gmail,
        href: "/app/email",
        action: progress.connected_gmail ? "Open" : "Connect",
      });

      items.push({
        id: "summary",
        label: progress.summarized_inbox ? "Inbox summarized" : "Summarize your inbox",
        done: progress.summarized_inbox,
        href: "/app/email",
        action: "Open",
      });
    }

    return items;
  }, [stats, progress]);

  function dismissSuccessBanner() {
    setShowSuccessBanner(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_SUCCESS_DISMISSED, "1");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {showSuccessBanner ? (
        <div className="relative rounded-[28px] border bg-card/80 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Workspace ready</div>
              <div className="mt-1 text-sm text-muted-foreground">
                You finished setup. Jump back into your workflow.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/app/chat"
                  className="inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                >
                  Open chat
                </Link>
                <Link
                  href="/app/docs"
                  className="inline-flex items-center justify-center rounded-2xl border bg-background px-4 py-3 text-sm"
                >
                  Open docs
                </Link>
              </div>
            </div>

            <button
              type="button"
              onClick={dismissSuccessBanner}
              className="rounded-xl border p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="Dismiss success banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-[28px] border bg-card/80 p-6 shadow-sm">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-2 text-sm text-muted-foreground">Here’s the next best step for your workspace.</p>
          </div>

          <div className="w-full md:w-auto md:min-w-[280px]">
            <div
              data-tour="dashboard-next-step"
              className="rounded-3xl border bg-background p-5"
            >
              <div className="text-sm font-medium">{hero.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{hero.body}</div>
              <div className="mt-4">
                <Link
                  href={hero.href}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                >
                  {hero.action}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={<Bot className="h-5 w-5" />} label="Bots" value={String(stats?.bots_count ?? "—")} />
        <StatCard icon={<FileText className="h-5 w-5" />} label="Documents" value={String(stats?.documents_count ?? "—")} />
        <StatCard icon={<CreditCard className="h-5 w-5" />} label="Plan" value={String(stats?.plan ?? "—")} />
        <StatCard
          icon={<CalendarDays className="h-5 w-5" />}
          label="Schedule"
          value={stats?.schedule_enabled ? "On" : "Off"}
        />
      </div>

      {showOnboarding ? (
        <div className="rounded-[28px] border bg-card/75 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-medium tracking-tight">Setup checklist</div>
              <div className="mt-1 text-sm text-muted-foreground">Finish these steps once, then move faster.</div>
            </div>

            <div className="min-w-[180px]">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {progress.completed_steps} of {progress.total_steps} done
                </span>
                <span>{progress.percent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {checklist.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/75 p-2 shadow-sm">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={[
            "rounded-xl px-3 py-2 text-sm transition",
            tab === "overview"
              ? "bg-accent text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          ].join(" ")}
        >
          Overview
        </button>

        <button
          type="button"
          onClick={() => setTab("notifications")}
          className={[
            "rounded-xl px-3 py-2 text-sm transition",
            tab === "notifications"
              ? "bg-accent text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          ].join(" ")}
        >
          Notifications
        </button>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div
            data-tour="dashboard-quick-actions"
            className="rounded-[28px] border bg-card/75 p-5 shadow-sm"
          >
            <div className="text-sm font-medium">Quick actions</div>
            <div className="mt-1 text-sm text-muted-foreground">Go straight to the pages you’ll use most.</div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <QuickLink href="/app/chat" title="Chat" desc="Ask Louis a question." />
              <QuickLink href="/app/docs" title="Documents" desc="Upload and manage docs." />
              <QuickLink href="/app/bots" title="Bots" desc="Create and manage bots." />
              <QuickLink href="/app/schedule" title="Schedule" desc="View tasks and events." />
              <QuickLink href="/app/email" title="Email" desc="Open inbox and send email." />
              <QuickLink href="/app/outreach" title="Outreach" desc="Create and run campaigns." />
            </div>
          </div>

          <div className="rounded-[28px] border bg-card/75 p-5 shadow-sm">
            <div className="text-sm font-medium">Your workspace</div>
            <div className="mt-1 text-sm text-muted-foreground">The core pages for your daily workflow.</div>

            <div className="mt-4 grid gap-3">
              <QuickLink href="/app/brain" title="Agency Brain" desc="Open your shared workspace view." />
              <QuickLink href="/app/notifications" title="Notifications" desc="Review reminders and updates." />
              <QuickLink href="/app/billing" title="Billing" desc="Manage plan and upgrades." />
              <QuickLink href="/app/support" title="Support" desc="Get help when you need it." />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[28px] border bg-card/75 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Bell className="h-3.5 w-3.5" />
                Notifications
              </div>
              <div className="mt-3 text-lg font-medium tracking-tight">Stay on top of what matters.</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Review reminders, schedule items, and workspace notices.
              </div>
            </div>

            <Link
              className="rounded-xl border bg-background px-3 py-2 text-sm transition hover:bg-accent"
              href="/app/notifications"
            >
              Open
            </Link>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <QuickLink href="/app/notifications" title="Notifications" desc="Open the full notifications page." />
            <QuickLink href="/app/schedule" title="Schedule" desc="Review tasks and events." />
            <QuickLink href="/app/support" title="Support" desc="Get help with your workspace." />
          </div>
        </div>
      )}
    </div>
  );
}