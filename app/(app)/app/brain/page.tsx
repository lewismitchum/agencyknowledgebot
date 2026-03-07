"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  Bot,
  Brain,
  CalendarDays,
  CreditCard,
  FileText,
  Mail,
  MessageSquare,
  Sparkles,
  Activity,
  Clock3,
} from "lucide-react";

type BotRow = {
  id: string;
  name: string;
  owner_user_id: string | null;
  vector_store_id: string | null;
};

type DocRow = {
  id: string;
  filename: string;
  openai_file_id: string | null;
  created_at: string;
  bot_id?: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  created_at: string;
  read_at: string | null;
};

type ExtractionRow = {
  id: string;
  agency_id: string;
  bot_id: string;
  document_id: string | null;
  title: string | null;
  created_at: string;
  display_title?: string | null;
};

type ActivityItem = {
  id: string;
  type: "document" | "extraction" | "notification";
  title: string;
  subtitle: string;
  created_at: string;
  href: string;
};

type BrainStats = {
  plan: string;
  schedule_enabled: boolean;
  email_enabled: boolean;
  agencyBots: number;
  privateBots: number;
  docsCount: number;
  unreadNotifications: number;
  recentDocs: DocRow[];
  urgentTasks: TaskRow[];
  recentActivity: ActivityItem[];
  unreadNotificationItems: NotificationRow[];
};

function shortFilename(name: string, max = 42) {
  const s = String(name || "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(12, max - 12)) + "…" + s.slice(-10);
}

function shortText(text: string | null | undefined, max = 90) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "No date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No date";
  return d.toLocaleString();
}

function formatDueLabel(value: string | null | undefined) {
  if (!value) return "No due date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No due date";

  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const isOverdue = diff < 0;

  return isOverdue ? `Overdue · ${d.toLocaleString()}` : `Due · ${d.toLocaleString()}`;
}

function isToday(value: string | null | undefined) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isOverdueTask(task: TaskRow) {
  if (!task.due_at) return false;
  const d = new Date(task.due_at);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now() && !isToday(task.due_at);
}

function isUpcomingTask(task: TaskRow) {
  if (!task.due_at) return true;
  const d = new Date(task.due_at);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() > Date.now() && !isToday(task.due_at);
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border bg-background/70 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-3xl border bg-card p-5 transition hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
            {icon}
          </div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{body}</p>
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
      </div>
    </Link>
  );
}

function TaskBucket({
  title,
  emptyText,
  tasks,
  tone,
}: {
  title: string;
  emptyText: string;
  tasks: TaskRow[];
  tone: "danger" | "default" | "muted";
}) {
  return (
    <div className="rounded-2xl border bg-background/45">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="text-sm font-medium">{title}</div>
        <div
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            tone === "danger"
              ? "bg-red-500/10 text-red-600 dark:text-red-400"
              : tone === "default"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
          ].join(" ")}
        >
          {tasks.length}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="divide-y">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href="/app/schedule"
              className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-accent/40"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{task.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{formatDueLabel(task.due_at)}</div>
              </div>

              <div
                className={[
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                  tone === "danger"
                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : tone === "default"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {title}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgencyBrainPage() {
  const [stats, setStats] = useState<BrainStats>({
    plan: "—",
    schedule_enabled: false,
    email_enabled: false,
    agencyBots: 0,
    privateBots: 0,
    docsCount: 0,
    unreadNotifications: 0,
    recentDocs: [],
    urgentTasks: [],
    recentActivity: [],
    unreadNotificationItems: [],
  });

  const [loading, setLoading] = useState(true);
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [onboardingRes, botsRes, notificationsRes, extractionsRes] = await Promise.allSettled([
          fetch("/api/onboarding", { credentials: "include", cache: "no-store" }),
          fetch("/api/bots", { credentials: "include", cache: "no-store" }),
          fetch("/api/notifications/list?limit=20", { credentials: "include", cache: "no-store" }),
          fetch("/api/extractions", { credentials: "include", cache: "no-store" }),
        ]);

        let plan = "free";
        let scheduleEnabled = false;
        let emailEnabled = false;

        if (onboardingRes.status === "fulfilled" && onboardingRes.value.ok) {
          const j = await onboardingRes.value.json().catch(() => null);
          plan = String(j?.plan ?? "free");
          scheduleEnabled = !!j?.schedule_enabled;
          emailEnabled = !!j?.email_enabled;
        }

        let bots: BotRow[] = [];
        if (botsRes.status === "fulfilled" && botsRes.value.ok) {
          const j = await botsRes.value.json().catch(() => null);
          bots = Array.isArray(j?.bots) ? (j.bots as BotRow[]) : [];
        }

        const agencyBots = bots.filter((b) => b.owner_user_id == null);
        const privateBots = bots.filter((b) => b.owner_user_id != null);

        const docsByBot = await Promise.all(
          bots.map(async (bot) => {
            try {
              const r = await fetch(`/api/documents?bot_id=${encodeURIComponent(bot.id)}`, {
                credentials: "include",
                cache: "no-store",
              });
              if (!r.ok) return [] as DocRow[];
              const j = await r.json().catch(() => null);
              const list = Array.isArray(j?.documents) ? (j.documents as any[]) : [];
              return list.map((doc) => ({
                id: String(doc?.id ?? ""),
                filename: String(doc?.title ?? doc?.filename ?? "Untitled"),
                openai_file_id: doc?.openai_file_id ? String(doc.openai_file_id) : null,
                created_at: String(doc?.created_at ?? ""),
                bot_id: String(doc?.bot_id ?? bot.id),
              })) as DocRow[];
            } catch {
              return [] as DocRow[];
            }
          })
        );

        const allDocs = docsByBot
          .flat()
          .filter((doc) => doc.id)
          .sort((a, b) => {
            const at = new Date(a.created_at || 0).getTime();
            const bt = new Date(b.created_at || 0).getTime();
            return bt - at;
          });

        const tasksByBot = scheduleEnabled
          ? await Promise.all(
              bots.map(async (bot) => {
                try {
                  const r = await fetch(`/api/schedule/tasks?bot_id=${encodeURIComponent(bot.id)}`, {
                    credentials: "include",
                    cache: "no-store",
                  });
                  if (!r.ok) return [] as TaskRow[];
                  const j = await r.json().catch(() => null);
                  return Array.isArray(j?.tasks) ? (j.tasks as TaskRow[]) : [];
                } catch {
                  return [] as TaskRow[];
                }
              })
            )
          : [];

        const allTasks = tasksByBot
          .flat()
          .filter((t) => String(t?.status ?? "open") !== "done")
          .sort((a, b) => {
            const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
            const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
            if (aDue !== bDue) return aDue - bDue;
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
          });

        let notifications: NotificationRow[] = [];
        let unreadNotifications = 0;
        if (notificationsRes.status === "fulfilled" && notificationsRes.value.ok) {
          const j = await notificationsRes.value.json().catch(() => null);
          notifications = Array.isArray(j?.notifications) ? (j.notifications as NotificationRow[]) : [];
          unreadNotifications = notifications.filter((n) => !n?.read_at).length;
        }

        let extractions: ExtractionRow[] = [];
        if (extractionsRes.status === "fulfilled" && extractionsRes.value.ok) {
          const j = await extractionsRes.value.json().catch(() => null);
          extractions = Array.isArray(j?.extractions) ? (j.extractions as ExtractionRow[]) : [];
        }

        const unreadNotificationItems = notifications.filter((n) => !n?.read_at).slice(0, 5);

        const activity: ActivityItem[] = [
          ...allDocs.slice(0, 6).map((doc) => ({
            id: `doc-${doc.id}`,
            type: "document" as const,
            title: shortFilename(doc.filename, 56),
            subtitle: "Document uploaded",
            created_at: doc.created_at,
            href: `/app/docs?bot_id=${encodeURIComponent(String(doc.bot_id || ""))}&doc_id=${encodeURIComponent(doc.id)}`,
          })),
          ...extractions.slice(0, 6).map((item) => ({
            id: `extract-${item.id}`,
            type: "extraction" as const,
            title: String(item.display_title || item.title || "Extraction"),
            subtitle: "Knowledge extracted",
            created_at: item.created_at,
            href: `/app/extractions?id=${encodeURIComponent(item.id)}`,
          })),
          ...notifications.slice(0, 6).map((item) => ({
            id: `notif-${item.id}`,
            type: "notification" as const,
            title: String(item.title || item.type || "Notification"),
            subtitle: item.read_at ? "Notification reviewed" : "Unread notification",
            created_at: item.created_at,
            href: item.url || "/app/notifications",
          })),
        ].sort((a, b) => {
          const at = new Date(a.created_at || 0).getTime();
          const bt = new Date(b.created_at || 0).getTime();
          return bt - at;
        });

        if (!cancelled) {
          setStats({
            plan,
            schedule_enabled: scheduleEnabled,
            email_enabled: emailEnabled,
            agencyBots: agencyBots.length,
            privateBots: privateBots.length,
            docsCount: allDocs.length,
            unreadNotifications,
            recentDocs: allDocs.slice(0, 6),
            urgentTasks: allTasks.slice(0, 9),
            recentActivity: activity.slice(0, 8),
            unreadNotificationItems,
          });
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function markNotificationRead(id: string) {
    if (!id || markingReadId) return;

    setMarkingReadId(id);

    const prev = stats;

    setStats((cur) => {
      const nextItems = cur.unreadNotificationItems.filter((n) => n.id !== id);
      return {
        ...cur,
        unreadNotifications: Math.max(0, cur.unreadNotifications - 1),
        unreadNotificationItems: nextItems,
        recentActivity: cur.recentActivity.map((item) =>
          item.id === `notif-${id}` ? { ...item, subtitle: "Notification reviewed" } : item
        ),
      };
    });

    try {
      const r = await fetch("/api/notifications/read", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!r.ok) {
        setStats(prev);
      }
    } catch {
      setStats(prev);
    } finally {
      setMarkingReadId(null);
    }
  }

  const planLabel = useMemo(() => {
    const raw = String(stats.plan || "free");
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [stats.plan]);

  const overdueTasks = useMemo(
    () => stats.urgentTasks.filter((task) => isOverdueTask(task)),
    [stats.urgentTasks]
  );

  const todayTasks = useMemo(
    () => stats.urgentTasks.filter((task) => !!task.due_at && isToday(task.due_at)),
    [stats.urgentTasks]
  );

  const upcomingTasks = useMemo(
    () => stats.urgentTasks.filter((task) => isUpcomingTask(task)),
    [stats.urgentTasks]
  );

  const todayUploadCount = useMemo(
    () => stats.recentDocs.filter((doc) => isToday(doc.created_at)).length,
    [stats.recentDocs]
  );

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="overflow-hidden rounded-3xl border bg-card">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
            <div className="relative flex flex-col gap-6 p-6 md:p-8 lg:p-10">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                Agency Brain
              </div>

              <div className="max-w-3xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    <Brain className="h-6 w-6 text-primary" />
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                    Your agency’s shared intelligence layer
                  </h1>
                </div>

                <p className="text-sm leading-6 text-muted-foreground md:text-base">
                  Agency Brain is the central place where Louis.Ai turns your documents,
                  conversations, schedules, and email activity into one organized knowledge
                  system for your whole team.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Agency bots"
                  value={loading ? "—" : String(stats.agencyBots)}
                  hint="Shared assistants available across the workspace."
                />
                <StatCard
                  label="Private bots"
                  value={loading ? "—" : String(stats.privateBots)}
                  hint="Personal assistants owned by individual users."
                />
                <StatCard
                  label="Documents"
                  value={loading ? "—" : String(stats.docsCount)}
                  hint="Uploaded knowledge currently available to the system."
                />
                <StatCard
                  label="Unread alerts"
                  value={loading ? "—" : String(stats.unreadNotifications)}
                  hint="Notifications still waiting for review."
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Overdue now
            </div>
            <div className="mt-2 text-2xl font-semibold">{loading ? "—" : String(overdueTasks.length)}</div>
            <div className="mt-1 text-sm text-muted-foreground">Tasks already past due.</div>
          </div>

          <div className="rounded-2xl border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Due today
            </div>
            <div className="mt-2 text-2xl font-semibold">{loading ? "—" : String(todayTasks.length)}</div>
            <div className="mt-1 text-sm text-muted-foreground">Tasks scheduled for today.</div>
          </div>

          <div className="rounded-2xl border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Unread notifications
            </div>
            <div className="mt-2 text-2xl font-semibold">{loading ? "—" : String(stats.unreadNotifications)}</div>
            <div className="mt-1 text-sm text-muted-foreground">Items still waiting for review.</div>
          </div>

          <div className="rounded-2xl border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Uploaded today
            </div>
            <div className="mt-2 text-2xl font-semibold">{loading ? "—" : String(todayUploadCount)}</div>
            <div className="mt-1 text-sm text-muted-foreground">New knowledge added today.</div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border bg-card p-5 xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Urgent tasks</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open schedule tasks grouped by what needs attention first.
                </p>
              </div>

              <Link
                href="/app/schedule"
                className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition hover:bg-accent"
              >
                Open Schedule
              </Link>
            </div>

            <div className="mt-4">
              {loading ? (
                <div className="rounded-2xl border bg-background/45 px-4 py-6 text-sm text-muted-foreground">
                  Loading tasks…
                </div>
              ) : !stats.schedule_enabled ? (
                <div className="rounded-2xl border bg-background/45 px-4 py-6 text-sm text-muted-foreground">
                  Schedule is locked on this plan.
                </div>
              ) : stats.urgentTasks.length === 0 ? (
                <div className="rounded-2xl border bg-background/45 px-4 py-6 text-sm text-muted-foreground">
                  No open tasks right now.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  <TaskBucket
                    title="Overdue"
                    emptyText="No overdue tasks."
                    tasks={overdueTasks}
                    tone="danger"
                  />
                  <TaskBucket
                    title="Today"
                    emptyText="Nothing due today."
                    tasks={todayTasks}
                    tone="default"
                  />
                  <TaskBucket
                    title="Upcoming"
                    emptyText="No upcoming tasks."
                    tasks={upcomingTasks}
                    tone="muted"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Operations snapshot</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Current workspace status at a glance.
            </p>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border bg-background/45 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan</div>
                <div className="mt-2 flex items-center gap-2 text-base font-semibold">
                  <CreditCard className="h-4 w-4 text-primary" />
                  {loading ? "—" : planLabel}
                </div>
              </div>

              <div className="rounded-2xl border bg-background/45 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Schedule</div>
                <div className="mt-2 flex items-center gap-2 text-base font-semibold">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {loading ? "—" : stats.schedule_enabled ? "Enabled" : "Locked"}
                </div>
              </div>

              <div className="rounded-2xl border bg-background/45 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</div>
                <div className="mt-2 flex items-center gap-2 text-base font-semibold">
                  <Mail className="h-4 w-4 text-primary" />
                  {loading ? "—" : stats.email_enabled ? "Enabled" : "Locked"}
                </div>
              </div>

              <div className="rounded-2xl border bg-background/45 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notifications</div>
                <div className="mt-2 flex items-center gap-2 text-base font-semibold">
                  <Bell className="h-4 w-4 text-primary" />
                  {loading ? "—" : `${stats.unreadNotifications} unread`}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border bg-card p-5 xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Recent activity</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Latest uploads, extractions, and notifications across the workspace.
                </p>
              </div>

              <Link
                href="/app/notifications"
                className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition hover:bg-accent"
              >
                Open Notifications
              </Link>
            </div>

            <div className="mt-4 rounded-2xl border bg-background/45">
              {loading ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">Loading activity…</div>
              ) : stats.recentActivity.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No recent activity yet.
                </div>
              ) : (
                <div className="divide-y">
                  {stats.recentActivity.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-accent/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.subtitle} · {formatDateTime(item.created_at)}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {item.type === "document" ? (
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        ) : item.type === "extraction" ? (
                          <Activity className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Bell className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Notifications focus</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Jump into the unread items that likely need action first.
                </p>
              </div>

              <Link
                href="/app/notifications"
                className="rounded-xl border bg-background/60 px-3 py-2 text-sm backdrop-blur transition hover:bg-accent"
              >
                View all
              </Link>
            </div>

            <div className="mt-4 rounded-2xl border bg-background/45">
              {loading ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">Loading notifications…</div>
              ) : stats.unreadNotificationItems.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No unread notifications right now.
                </div>
              ) : (
                <div className="divide-y">
                  {stats.unreadNotificationItems.map((item) => (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                          <Bell className="h-4 w-4 text-primary" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {String(item.title || item.type || "Notification")}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(item.created_at)}
                          </div>
                          {item.body ? (
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">
                              {shortText(item.body, 120)}
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              href={item.url || "/app/notifications"}
                              className="inline-flex items-center justify-center rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:opacity-95"
                            >
                              Open
                            </Link>

                            <button
                              type="button"
                              onClick={() => markNotificationRead(item.id)}
                              disabled={markingReadId === item.id}
                              className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-xs transition hover:bg-accent disabled:opacity-50"
                            >
                              {markingReadId === item.id ? "Marking…" : "Mark read"}
                            </button>

                            <Link
                              href="/app/notifications"
                              className="inline-flex items-center justify-center rounded-xl border bg-background/60 px-3 py-2 text-xs transition hover:bg-accent"
                            >
                              View all notifications
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <ActionCard
            href="/app/docs"
            icon={<FileText className="h-5 w-5 text-primary" />}
            title="Documents"
            body="Upload and manage the files Louis.Ai uses to ground internal answers."
          />

          <ActionCard
            href="/app/chat"
            icon={<MessageSquare className="h-5 w-5 text-primary" />}
            title="Chat"
            body="Ask questions, reason over uploads, and use Louis.Ai like your agency copilot."
          />

          <ActionCard
            href="/app/schedule"
            icon={<CalendarDays className="h-5 w-5 text-primary" />}
            title="Schedule"
            body="View extracted meetings, tasks, and reminders in one operational calendar."
          />

          <ActionCard
            href="/app/email"
            icon={<Mail className="h-5 w-5 text-primary" />}
            title="Email"
            body="Connect inbox activity to the rest of your agency brain."
          />

          <ActionCard
            href="/app/bots"
            icon={<Bot className="h-5 w-5 text-primary" />}
            title="Bots"
            body="Manage agency bots and private bots that power your knowledge system."
          />

          <ActionCard
            href="/app/notifications"
            icon={<Bell className="h-5 w-5 text-primary" />}
            title="Notifications"
            body="Review reminders, extraction outcomes, and account notices from one place."
          />
        </section>

        <section className="rounded-3xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">What comes next</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Agency Brain is now your live operational layer. The next upgrade is inbox priorities,
                richer schedule focus, and deeper activity summaries.
              </p>
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
              <Brain className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border bg-background/45 p-4">
              <div className="text-sm font-medium">Inbox priorities</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Surface urgent email threads directly inside Brain.
              </div>
            </div>

            <div className="rounded-2xl border bg-background/45 p-4">
              <div className="text-sm font-medium">Task focus blocks</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Highlight today’s most time-sensitive work automatically.
              </div>
            </div>

            <div className="rounded-2xl border bg-background/45 p-4">
              <div className="text-sm font-medium">Smarter activity summaries</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Turn raw events into one clean daily operational summary.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}