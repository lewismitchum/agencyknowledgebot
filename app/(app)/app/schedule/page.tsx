// app/(app)/app/schedule/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type BotLite = { id: string; name: string };

type EventRow = {
  id: string;
  title: string;
  start_at: string;
  end_at?: string | null;
  location?: string | null;
  notes?: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  due_at?: string | null;
  status: "open" | "done";
  notes?: string | null;
  created_at: string;
};

type Prefs = {
  timezone: string | null;
  week_starts_on: "sun" | "mon";
  default_view: "day" | "week" | "month";
  show_tasks: boolean;
  show_events: boolean;
  show_done_tasks: boolean;
};

const DEFAULT_PREFS: Prefs = {
  timezone: null,
  week_starts_on: "mon",
  default_view: "week",
  show_tasks: true,
  show_events: true,
  show_done_tasks: false,
};

function isoDayKey(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function startOfWeek(d: Date, weekStartsOn: "sun" | "mon") {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const offset = weekStartsOn === "sun" ? day : day === 0 ? 6 : day - 1; // Mon-start
  x.setDate(x.getDate() - offset);
  return x;
}

function endOfWeek(d: Date, weekStartsOn: "sun" | "mon") {
  const s = startOfWeek(d, weekStartsOn);
  const x = new Date(s);
  x.setDate(s.getDate() + 6);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}

function endOfMonth(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0); // last day of previous month
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function weekdayLabels(weekStartsOn: "sun" | "mon") {
  return weekStartsOn === "sun"
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}

export default function SchedulePage() {
  const [bots, setBots] = useState<BotLite[]>([]);
  const [botId, setBotId] = useState<string>("");

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [view, setView] = useState<Prefs["default_view"]>(DEFAULT_PREFS.default_view);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  const [search, setSearch] = useState("");
  const [day, setDay] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const tzLabel = useMemo(() => {
    try {
      return prefs.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
    } catch {
      return prefs.timezone || "Local";
    }
  }, [prefs.timezone]);

  async function loadBots() {
    const r = await fetch("/api/bots", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    const list = Array.isArray(j?.bots) ? j.bots : [];
    const lite = list.map((b: any) => ({ id: String(b.id), name: String(b.name || "Bot") }));
    setBots(lite);
    if (!botId && lite.length) setBotId(lite[0].id);
  }

  async function loadPrefs() {
    const r = await fetch("/api/schedule/prefs", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.ok) {
      const p = j.prefs ? { ...DEFAULT_PREFS, ...j.prefs } : DEFAULT_PREFS;
      setPrefs(p);
      setView(p.default_view);
    }
  }

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    await fetch("/api/schedule/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  }

  async function loadData(activeBotId: string) {
    setLoading(true);
    setErr("");
    try {
      const [re, rt] = await Promise.all([
        fetch(`/api/schedule/events?bot_id=${encodeURIComponent(activeBotId)}`, { cache: "no-store" }),
        fetch(`/api/schedule/tasks?bot_id=${encodeURIComponent(activeBotId)}`, { cache: "no-store" }),
      ]);
      const je = await re.json().catch(() => ({}));
      const jt = await rt.json().catch(() => ({}));

      if (!re.ok) throw new Error(je?.error || je?.message || "Failed to load events");
      if (!rt.ok) throw new Error(jt?.error || jt?.message || "Failed to load tasks");

      setEvents(Array.isArray(je?.events) ? (je.events as EventRow[]) : []);
      setTasks(Array.isArray(jt?.tasks) ? (jt.tasks as TaskRow[]) : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrefs();
    loadBots();
  }, []);

  useEffect(() => {
    if (botId) loadData(botId);
  }, [botId]);

  const filteredEvents = useMemo(() => {
    if (!prefs.show_events) return [];
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (!q) return true;
      return (
        String(e.title || "").toLowerCase().includes(q) ||
        String(e.location || "").toLowerCase().includes(q) ||
        String(e.notes || "").toLowerCase().includes(q)
      );
    });
  }, [events, prefs.show_events, search]);

  const filteredTasks = useMemo(() => {
    if (!prefs.show_tasks) return [];
    const q = search.trim().toLowerCase();
    return tasks
      .filter((t) => (prefs.show_done_tasks ? true : t.status !== "done"))
      .filter((t) => {
        if (!q) return true;
        return String(t.title || "").toLowerCase().includes(q) || String(t.notes || "").toLowerCase().includes(q);
      });
  }, [tasks, prefs.show_tasks, prefs.show_done_tasks, search]);

  const dayKey = isoDayKey(day);

  const weekStart = useMemo(() => startOfWeek(day, prefs.week_starts_on), [day, prefs.week_starts_on]);
  const weekDays = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 7; i++) arr.push(addDays(weekStart, i));
    return arr;
  }, [weekStart]);

  const monthDays = useMemo(() => {
    const mStart = startOfMonth(day);
    const mEnd = endOfMonth(day);
    const gridStart = startOfWeek(mStart, prefs.week_starts_on);
    const gridEnd = endOfWeek(mEnd, prefs.week_starts_on);

    const arr: Date[] = [];
    let cur = new Date(gridStart);
    cur.setHours(0, 0, 0, 0);

    while (cur.getTime() <= gridEnd.getTime()) {
      arr.push(new Date(cur));
      cur = addDays(cur, 1);
    }
    return arr;
  }, [day, prefs.week_starts_on]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, EventRow[]>();
    for (const e of filteredEvents) {
      const k = (e.start_at || "").slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    for (const [k, arr] of m) {
      arr.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
      m.set(k, arr);
    }
    return m;
  }, [filteredEvents]);

  const tasksByDay = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of filteredTasks) {
      const k = t.due_at ? String(t.due_at).slice(0, 10) : "no_due";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [filteredTasks]);

  async function toggleTask(id: string, status: "open" | "done") {
    const nextStatus = status === "open" ? "done" : "open";
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: nextStatus } : t)));
    try {
      const r = await fetch("/api/schedule/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: nextStatus }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Failed to update");
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    }
  }

  async function deleteEvent(id: string) {
    // optimistic: remove locally first
    const prev = events;
    setEvents((cur) => cur.filter((e) => e.id !== id));
    try {
      const r = await fetch("/api/schedule/events", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Failed to delete");
    } catch {
      setEvents(prev);
    }
  }

  function moveAnchor(deltaDays: number) {
    const d = new Date(day);
    d.setDate(day.getDate() + deltaDays);
    setDay(d);
  }

  const headerLabel = useMemo(() => {
    if (view === "day") return dayKey;
    if (view === "week") return `${isoDayKey(weekDays[0])} → ${isoDayKey(weekDays[6])}`;
    return day.toLocaleString(undefined, { month: "long", year: "numeric" });
  }, [view, dayKey, weekDays, day]);

  const prevDelta = view === "day" ? -1 : view === "week" ? -7 : -28;
  const nextDelta = view === "day" ? 1 : view === "week" ? 7 : 28;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-2 text-sm text-muted-foreground">{tzLabel} · personalized views · tasks + events</p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <select
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
            className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring md:w-64"
          >
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <div className="flex rounded-xl border bg-background p-1">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setView(v);
                  savePrefs({ ...prefs, default_view: v });
                }}
                className={[
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  view === v ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                ].join(" ")}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border bg-card p-5 shadow-sm md:col-span-2">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <button className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" onClick={() => moveAnchor(prevDelta)}>
                ←
              </button>
              <button className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" onClick={() => setDay(new Date())}>
                Today
              </button>
              <button className="rounded-xl border px-3 py-2 text-sm hover:bg-accent" onClick={() => moveAnchor(nextDelta)}>
                →
              </button>
              <span className="ml-2 text-sm font-medium">{headerLabel}</span>
            </div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events and tasks…"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring md:w-72"
            />
          </div>

          <div className="mt-4 rounded-2xl border bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Toggle label="Events" checked={prefs.show_events} onChange={(v) => savePrefs({ ...prefs, show_events: v })} />
              <Toggle label="Tasks" checked={prefs.show_tasks} onChange={(v) => savePrefs({ ...prefs, show_tasks: v })} />
              <Toggle
                label="Show done"
                checked={prefs.show_done_tasks}
                onChange={(v) => savePrefs({ ...prefs, show_done_tasks: v })}
              />

              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Week starts</span>
                <select
                  value={prefs.week_starts_on}
                  onChange={(e) => savePrefs({ ...prefs, week_starts_on: e.target.value as any })}
                  className="rounded-xl border bg-background px-2 py-1.5 text-xs outline-none"
                >
                  <option value="mon">Mon</option>
                  <option value="sun">Sun</option>
                </select>

                <button onClick={() => botId && loadData(botId)} className="rounded-xl border px-3 py-2 text-sm hover:bg-accent">
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : err ? (
              <div className="rounded-2xl border bg-muted p-4 text-sm">
                <div className="font-medium">Schedule error</div>
                <div className="mt-1 text-muted-foreground">{err}</div>
              </div>
            ) : view === "day" ? (
              <DayView
                dayKey={dayKey}
                events={eventsByDay.get(dayKey) || []}
                tasks={(tasksByDay.get(dayKey) || []).concat(tasksByDay.get("no_due") || [])}
                onToggleTask={toggleTask}
                onDeleteEvent={deleteEvent}
              />
            ) : view === "week" ? (
              <WeekView
                weekDays={weekDays}
                eventsByDay={eventsByDay}
                tasksByDay={tasksByDay}
                onToggleTask={toggleTask}
                onDeleteEvent={deleteEvent}
              />
            ) : (
              <MonthView
                monthDays={monthDays}
                anchorDay={day}
                weekStartsOn={prefs.week_starts_on}
                eventsByDay={eventsByDay}
                tasksByDay={tasksByDay}
                onToggleTask={toggleTask}
              />
            )}
          </div>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="text-sm font-medium">Quick add</div>
          <div className="mt-1 text-xs text-muted-foreground">Manual add is fine. Auto extraction becomes paid-only later.</div>

          <QuickAdd botId={botId} onAdded={() => botId && loadData(botId)} />
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={[
        "rounded-xl border px-3 py-2 text-sm transition-colors",
        checked ? "bg-accent text-foreground" : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function DayView({
  dayKey,
  events,
  tasks,
  onToggleTask,
  onDeleteEvent,
}: {
  dayKey: string;
  events: EventRow[];
  tasks: TaskRow[];
  onToggleTask: (id: string, status: "open" | "done") => void;
  onDeleteEvent: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">
        Day: <span className="font-mono">{dayKey}</span>
      </div>

      <Section title="Events">
        {events.length ? (
          <div className="space-y-2">
            {events.map((e) => (
              <div key={e.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{e.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {e.start_at}
                      {e.end_at ? ` → ${e.end_at}` : ""}
                      {e.location ? ` · ${e.location}` : ""}
                    </div>
                  </div>

                  <button
                    onClick={() => onDeleteEvent(e.id)}
                    className="rounded-xl border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Delete event"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No events.</div>
        )}
      </Section>

      <Section title="Tasks">
        {tasks.length ? (
          <div className="space-y-2">
            {tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => onToggleTask(t.id, t.status)}
                className="flex w-full items-start justify-between gap-3 rounded-2xl border p-3 text-left hover:bg-accent"
              >
                <div>
                  <div className="font-medium">{t.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t.due_at ? `due ${t.due_at}` : "no due date"}</div>
                </div>
                <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">{t.status}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No tasks.</div>
        )}
      </Section>
    </div>
  );
}

function WeekView({
  weekDays,
  eventsByDay,
  tasksByDay,
  onToggleTask,
  onDeleteEvent,
}: {
  weekDays: Date[];
  eventsByDay: Map<string, EventRow[]>;
  tasksByDay: Map<string, TaskRow[]>;
  onToggleTask: (id: string, status: "open" | "done") => void;
  onDeleteEvent: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {weekDays.map((d) => {
        const k = isoDayKey(d);
        const ev = eventsByDay.get(k) || [];
        const tk = tasksByDay.get(k) || [];
        return (
          <div key={k} className="rounded-2xl border p-4">
            <div className="font-medium">{k}</div>

            <div className="mt-3 text-xs font-medium text-muted-foreground">Events</div>
            {ev.length ? (
              <div className="mt-2 space-y-2">
                {ev.slice(0, 4).map((e) => (
                  <div key={e.id} className="rounded-xl border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{e.title}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{e.start_at}</div>
                      </div>
                      <button
                        onClick={() => onDeleteEvent(e.id)}
                        className="shrink-0 rounded-lg border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Delete event"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}
                {ev.length > 4 ? <div className="text-xs text-muted-foreground">+{ev.length - 4} more</div> : null}
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">—</div>
            )}

            <div className="mt-4 text-xs font-medium text-muted-foreground">Tasks</div>
            {tk.length ? (
              <div className="mt-2 space-y-2">
                {tk.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onToggleTask(t.id, t.status)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border p-2 text-left hover:bg-accent"
                  >
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{t.status}</span>
                  </button>
                ))}
                {tk.length > 4 ? <div className="text-xs text-muted-foreground">+{tk.length - 4} more</div> : null}
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">—</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthView({
  monthDays,
  anchorDay,
  weekStartsOn,
  eventsByDay,
  tasksByDay,
  onToggleTask,
}: {
  monthDays: Date[];
  anchorDay: Date;
  weekStartsOn: "sun" | "mon";
  eventsByDay: Map<string, EventRow[]>;
  tasksByDay: Map<string, TaskRow[]>;
  onToggleTask: (id: string, status: "open" | "done") => void;
}) {
  const labels = weekdayLabels(weekStartsOn);
  const weeks = Math.ceil(monthDays.length / 7);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground">
        {labels.map((x) => (
          <div key={x} className="px-1">
            {x}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {monthDays.map((d) => {
          const k = isoDayKey(d);
          const ev = eventsByDay.get(k) || [];
          const tk = tasksByDay.get(k) || [];
          const inMonth = sameMonth(d, anchorDay);

          return (
            <div
              key={k}
              className={[
                "min-h-[110px] rounded-2xl border p-2",
                inMonth ? "bg-background/40" : "bg-muted/30 opacity-70",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">{d.getDate()}</div>
                <div className="text-[11px] text-muted-foreground">
                  {ev.length ? `${ev.length}e` : ""}
                  {ev.length && tk.length ? " · " : ""}
                  {tk.length ? `${tk.length}t` : ""}
                </div>
              </div>

              <div className="mt-2 space-y-1">
                {ev.slice(0, 2).map((e) => (
                  <div key={e.id} className="truncate rounded-lg border px-2 py-1 text-xs" title={e.title}>
                    {e.title}
                  </div>
                ))}
                {tk.slice(0, 2).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onToggleTask(t.id, t.status)}
                    className="flex w-full items-center justify-between gap-2 truncate rounded-lg border px-2 py-1 text-xs hover:bg-accent"
                    title="Toggle task"
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="text-[10px] text-muted-foreground">{t.status}</span>
                  </button>
                ))}
                {ev.length + tk.length > 4 ? (
                  <div className="text-[11px] text-muted-foreground">+{ev.length + tk.length - 4} more</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[11px] text-muted-foreground">
        Showing {weeks} week{weeks === 1 ? "" : "s"} ({monthDays.length} days)
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-background/40 p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function QuickAdd({ botId, onAdded }: { botId: string; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [mode, setMode] = useState<"event" | "task">("event");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!botId) return;
    if (!title.trim()) return;

    if (mode === "event" && !when.trim()) return;

    setLoading(true);
    try {
      if (mode === "event") {
        await fetch("/api/schedule/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bot_id: botId, title: title.trim(), start_at: when.trim() }),
        });
      } else {
        await fetch("/api/schedule/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bot_id: botId, title: title.trim(), due_at: when.trim() ? when.trim() : null }),
        });
      }

      setTitle("");
      setWhen("");
      onAdded();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex rounded-xl border bg-background p-1">
        {(["event", "task"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={[
              "flex-1 rounded-lg px-3 py-2 text-sm transition-colors",
              mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            {m === "event" ? "Event" : "Task"}
          </button>
        ))}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={mode === "event" ? "Event title" : "Task title"}
        className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />

      <input
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        placeholder={mode === "event" ? "Start at (ISO string)" : "Due at (ISO or blank)"}
        className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />

      <button
        onClick={submit}
        disabled={loading}
        className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {loading ? "Adding…" : "Add"}
      </button>

      <div className="rounded-2xl border bg-muted p-3 text-xs text-muted-foreground">
        Tip: use ISO like <span className="font-mono">2026-02-10T14:00:00Z</span>
      </div>
    </div>
  );
}