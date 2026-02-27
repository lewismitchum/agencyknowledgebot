// app/(app)/app/schedule/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

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

const ALL_BOTS_ID = "__all__";

function safeTz(prefTz: string | null, agencyTz: string | null) {
  const tz = String(prefTz || agencyTz || "").trim();
  return tz || "America/Chicago";
}

function dayKeyInTz(d: Date, tz: string) {
  // en-CA -> YYYY-MM-DD
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
}

function dateFromDayKey(dayKey: string) {
  // Noon UTC avoids DST edge weirdness when adding/subtracting days.
  return new Date(`${dayKey}T12:00:00Z`);
}

function addDaysUtc(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function ymdToParts(dayKey: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), da: Number(m[3]) };
}

function dowInTz(d: Date, tz: string) {
  // 0..6 = Sun..Sat
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

function startOfWeekByTz(anchorDayKey: string, weekStartsOn: "sun" | "mon", tz: string) {
  const d = dateFromDayKey(anchorDayKey);
  const day = dowInTz(d, tz); // 0 Sun .. 6 Sat
  const offset = weekStartsOn === "sun" ? day : day === 0 ? 6 : day - 1; // Mon-start
  const start = addDaysUtc(d, -offset);
  return dayKeyInTz(start, tz);
}

function endOfWeekByTz(anchorDayKey: string, weekStartsOn: "sun" | "mon", tz: string) {
  const s = startOfWeekByTz(anchorDayKey, weekStartsOn, tz);
  const d = dateFromDayKey(s);
  const end = addDaysUtc(d, 6);
  return dayKeyInTz(end, tz);
}

function startOfMonthByTz(anchorDayKey: string) {
  const p = ymdToParts(anchorDayKey);
  if (!p) return anchorDayKey;
  return `${String(p.y).padStart(4, "0")}-${String(p.mo).padStart(2, "0")}-01`;
}

function endOfMonthByTz(anchorDayKey: string) {
  const p = ymdToParts(anchorDayKey);
  if (!p) return anchorDayKey;

  // first day of next month, minus 1 day
  let y = p.y;
  let mo = p.mo + 1;
  if (mo === 13) {
    mo = 1;
    y += 1;
  }
  const nextFirst = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`;
  const prev = addDaysUtc(dateFromDayKey(nextFirst), -1);
  return prev.toISOString().slice(0, 10); // safe because it's noon UTC
}

function sameMonthByKey(a: string, b: string) {
  return a.slice(0, 7) === b.slice(0, 7);
}

function weekdayLabels(weekStartsOn: "sun" | "mon") {
  return weekStartsOn === "sun"
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}

function formatReadableDateKey(dayKey: string, tz: string) {
  try {
    const d = dateFromDayKey(dayKey);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return dayKey;
  }
}

function formatDateTime(iso: string, tz: string) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return s;
  }
}

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

export default function SchedulePage() {
  const [bots, setBots] = useState<BotLite[]>([]);
  const [botId, setBotId] = useState<string>("");

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [view, setView] = useState<Prefs["default_view"]>(DEFAULT_PREFS.default_view);

  const [agencyTimezone, setAgencyTimezone] = useState<string | null>(null);
  const tz = useMemo(() => safeTz(prefs.timezone, agencyTimezone), [prefs.timezone, agencyTimezone]);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  const [search, setSearch] = useState("");
  const [anchorDayKey, setAnchorDayKey] = useState<string>(() => dayKeyInTz(new Date(), "America/Chicago"));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [gated, setGated] = useState(false);

  const tzLabel = useMemo(() => tz || "America/Chicago", [tz]);

  const botNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bots) m.set(b.id, b.name);
    return m;
  }, [bots]);

  function handleCommonErrors(e: any) {
    if (isFetchJsonError(e)) {
      if (e.status === 401) {
        window.location.href = "/login";
        return true;
      }
      if (e.status === 403) {
        setGated(true);
        return true;
      }
    }
    return false;
  }

  async function loadBots() {
    try {
      const j = await fetchJson<{ bots?: any[] }>("/api/bots", {
        cache: "no-store",
        credentials: "include",
      });
      const list = Array.isArray(j?.bots) ? j.bots : [];
      const lite = list.map((b: any) => ({ id: String(b.id), name: String(b.name || "Bot") }));
      setBots(lite);
      if (!botId && lite.length) setBotId(lite[0].id);
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      console.error(e);
    }
  }

  async function loadAgencyTimezone() {
    try {
      const j = await fetchJson<{ ok?: boolean; timezone?: string; today?: string }>("/api/schedule/timezone", {
        cache: "no-store",
        credentials: "include",
      });

      if (j?.ok) {
        const t = String(j?.timezone || "").trim();
        const today = String(j?.today || "").trim();
        if (t) setAgencyTimezone(t);
        if (today) setAnchorDayKey(today);
      }
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      console.error(e);
    }
  }

  async function loadPrefs() {
    try {
      const j = await fetchJson<{ ok?: boolean; prefs?: Partial<Prefs> }>("/api/schedule/prefs", {
        cache: "no-store",
        credentials: "include",
      });

      if (j?.ok) {
        const p = j.prefs ? { ...DEFAULT_PREFS, ...j.prefs } : DEFAULT_PREFS;
        setPrefs(p);
        setView(p.default_view);
      }
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      console.error(e);
    }
  }

  async function savePrefs(next: Prefs) {
    setPrefs(next);
    try {
      await fetchJson<{ ok?: boolean }>("/api/schedule/prefs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
        credentials: "include",
      });
    } catch (e: any) {
      if (handleCommonErrors(e)) return;
      console.error(e);
    }
  }

  async function loadDataForOne(activeBotId: string) {
    const [je, jt] = await Promise.all([
      fetchJson<{ events?: any[] }>(`/api/schedule/events?bot_id=${encodeURIComponent(activeBotId)}`, {
        cache: "no-store",
        credentials: "include",
      }),
      fetchJson<{ tasks?: any[] }>(`/api/schedule/tasks?bot_id=${encodeURIComponent(activeBotId)}`, {
        cache: "no-store",
        credentials: "include",
      }),
    ]);

    const ev = Array.isArray(je?.events) ? (je.events as EventRow[]) : [];
    const tk = Array.isArray(jt?.tasks) ? (jt.tasks as TaskRow[]) : [];

    return { ev, tk };
  }

  async function loadDataAllBots() {
    if (!bots.length) return { ev: [] as any[], tk: [] as any[] };

    const results = await Promise.all(
      bots.map(async (b) => {
        const { ev, tk } = await loadDataForOne(b.id);
        return {
          botId: b.id,
          ev: ev.map((x: any) => ({ ...x, bot_id: b.id })),
          tk: tk.map((x: any) => ({ ...x, bot_id: b.id })),
        };
      })
    );

    const allEv = results.flatMap((r) => r.ev);
    const allTk = results.flatMap((r) => r.tk);

    return { ev: allEv, tk: allTk };
  }

  async function loadData(activeBotId: string) {
    setLoading(true);
    setErr("");
    setGated(false);

    try {
      if (activeBotId === ALL_BOTS_ID) {
        const { ev, tk } = await loadDataAllBots();
        setEvents(ev as any);
        setTasks(tk as any);
      } else {
        const { ev, tk } = await loadDataForOne(activeBotId);
        setEvents(ev);
        setTasks(tk);
      }
    } catch (e: any) {
      if (handleCommonErrors(e)) {
        setLoading(false);
        return;
      }
      setErr(e?.message || "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrefs();
    loadBots();
    loadAgencyTimezone();
  }, []);

  useEffect(() => {
    // once we know tz (prefs or agency), reset anchor day key to "today in tz"
    const today = dayKeyInTz(new Date(), tz);
    setAnchorDayKey(today);
  }, [tz]);

  useEffect(() => {
    if (botId) loadData(botId);
  }, [botId]);

  const filteredEvents = useMemo(() => {
    if (!prefs.show_events) return [];
    const q = search.trim().toLowerCase();
    return (events as any[]).filter((e) => {
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
    return (tasks as any[])
      .filter((t) => (prefs.show_done_tasks ? true : t.status !== "done"))
      .filter((t) => {
        if (!q) return true;
        return String(t.title || "").toLowerCase().includes(q) || String(t.notes || "").toLowerCase().includes(q);
      });
  }, [tasks, prefs.show_tasks, prefs.show_done_tasks, search]);

  const dayKey = anchorDayKey;

  const weekStartKey = useMemo(() => startOfWeekByTz(dayKey, prefs.week_starts_on, tz), [dayKey, prefs.week_starts_on, tz]);
  const weekDays = useMemo(() => {
    const arr: string[] = [];
    const start = dateFromDayKey(weekStartKey);
    for (let i = 0; i < 7; i++) {
      arr.push(dayKeyInTz(addDaysUtc(start, i), tz));
    }
    return arr;
  }, [weekStartKey, tz]);

  const monthDays = useMemo(() => {
    const mStartKey = startOfMonthByTz(dayKey);
    const mEndKey = endOfMonthByTz(dayKey);

    const gridStartKey = startOfWeekByTz(mStartKey, prefs.week_starts_on, tz);
    const gridEndKey = endOfWeekByTz(mEndKey, prefs.week_starts_on, tz);

    const start = dateFromDayKey(gridStartKey);
    const end = dateFromDayKey(gridEndKey);

    const arr: string[] = [];
    let cur = new Date(start);

    while (cur.getTime() <= end.getTime()) {
      arr.push(dayKeyInTz(cur, tz));
      cur = addDaysUtc(cur, 1);
    }
    return arr;
  }, [dayKey, prefs.week_starts_on, tz]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, (EventRow & { bot_id?: string })[]>();
    for (const e of filteredEvents as any[]) {
      const k = e.start_at ? dayKeyInTz(new Date(String(e.start_at)), tz) : "";
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    for (const [k, arr] of m) {
      arr.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
      m.set(k, arr);
    }
    return m;
  }, [filteredEvents, tz]);

  const tasksByDay = useMemo(() => {
    const m = new Map<string, (TaskRow & { bot_id?: string })[]>();
    for (const t of filteredTasks as any[]) {
      const k = t.due_at ? dayKeyInTz(new Date(String(t.due_at)), tz) : "no_due";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [filteredTasks, tz]);

  const selectedDayTasks = useMemo(() => tasksByDay.get(dayKey) || [], [tasksByDay, dayKey]);
  const noDueTasks = useMemo(() => tasksByDay.get("no_due") || [], [tasksByDay]);

  async function toggleTask(id: string, status: "open" | "done") {
    setErr("");
    const nextStatus = status === "open" ? "done" : "open";
    setTasks((prev: any[]) => prev.map((t) => (t.id === id ? { ...t, status: nextStatus } : t)));

    try {
      await fetchJson<{ ok?: boolean }>("/api/schedule/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: nextStatus }),
        credentials: "include",
      });
    } catch (e: any) {
      if (handleCommonErrors(e)) {
        setTasks((prev: any[]) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
        return;
      }
      setTasks((prev: any[]) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
      setErr(e?.message || "Failed to update task");
    }
  }

  async function deleteTask(id: string) {
    const ok = window.confirm("Delete this task?\n\nThis can’t be undone.");
    if (!ok) return;

    setErr("");
    const prev = tasks as any[];
    setTasks((cur: any[]) => cur.filter((t) => t.id !== id));

    try {
      await fetchJson<{ ok?: boolean }>("/api/schedule/tasks", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
        credentials: "include",
      });
    } catch (e: any) {
      if (handleCommonErrors(e)) {
        setTasks(prev);
        return;
      }
      setTasks(prev);
      setErr(e?.message || "Failed to delete task");
    }
  }

  async function deleteEvent(id: string) {
    const ok = window.confirm("Delete this event?\n\nThis can’t be undone.");
    if (!ok) return;

    setErr("");
    const prev = events as any[];
    setEvents((cur: any[]) => cur.filter((e) => e.id !== id));

    try {
      await fetchJson<{ ok?: boolean }>("/api/schedule/events", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
        credentials: "include",
      });
    } catch (e: any) {
      if (handleCommonErrors(e)) {
        setEvents(prev);
        return;
      }
      setEvents(prev);
      setErr(e?.message || "Failed to delete event");
    }
  }

  function moveAnchor(deltaDays: number) {
    const d = addDaysUtc(dateFromDayKey(anchorDayKey), deltaDays);
    setAnchorDayKey(dayKeyInTz(d, tz));
  }

  function moveAnchorMonth(deltaMonths: number) {
    const p = ymdToParts(anchorDayKey);
    if (!p) return;

    let y = p.y;
    let mo = p.mo + deltaMonths;

    while (mo <= 0) {
      mo += 12;
      y -= 1;
    }
    while (mo >= 13) {
      mo -= 12;
      y += 1;
    }

    const next = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`;
    setAnchorDayKey(next);
  }

  const headerLabel = useMemo(() => {
    if (view === "day") return dayKey;
    if (view === "week") return `${weekDays[0]} → ${weekDays[6]}`;
    return formatReadableDateKey(startOfMonthByTz(dayKey), tz).replace(/,\s*\d{4}$/, (m) => m);
  }, [view, dayKey, weekDays, tz]);

  const prevDelta = view === "day" ? -1 : view === "week" ? -7 : -28;
  const nextDelta = view === "day" ? 1 : view === "week" ? 7 : 28;

  if (gated) {
    return (
      <UpgradeGate
        title="Schedule is a paid feature"
        message="Upgrade your plan to unlock tasks, events, and schedule views."
        ctaHref="/billing"
        ctaLabel="Upgrade Plan"
      />
    );
  }

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
            <option value={ALL_BOTS_ID}>All bots</option>
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
                type="button"
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border bg-card p-5 shadow-sm md:col-span-2">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                onClick={() => (view === "month" ? moveAnchorMonth(-1) : moveAnchor(prevDelta))}
                type="button"
              >
                ←
              </button>
              <button
                className="rounded-xl border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                onClick={() => setAnchorDayKey(dayKeyInTz(new Date(), tz))}
                type="button"
              >
                Today
              </button>
              <button
                className="rounded-xl border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                onClick={() => (view === "month" ? moveAnchorMonth(1) : moveAnchor(nextDelta))}
                type="button"
              >
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
              <Toggle label="Show done" checked={prefs.show_done_tasks} onChange={(v) => savePrefs({ ...prefs, show_done_tasks: v })} />

              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Week starts</span>
                <select
                  value={prefs.week_starts_on}
                  onChange={(e) => savePrefs({ ...prefs, week_starts_on: e.target.value as any })}
                  className="rounded-xl border bg-background px-2 py-1.5 text-xs outline-none disabled:opacity-60"
                >
                  <option value="mon">Mon</option>
                  <option value="sun">Sun</option>
                </select>

                <button
                  onClick={() => botId && loadData(botId)}
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                  type="button"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : view === "day" ? (
              <DayView
                dayKey={dayKey}
                tz={tz}
                events={eventsByDay.get(dayKey) || []}
                tasks={(tasksByDay.get(dayKey) || []).concat(tasksByDay.get("no_due") || [])}
                onToggleTask={toggleTask}
                onDeleteTask={deleteTask}
                onDeleteEvent={deleteEvent}
                botNameById={botNameById}
              />
            ) : view === "week" ? (
              <WeekView
                weekDays={weekDays}
                tz={tz}
                eventsByDay={eventsByDay}
                tasksByDay={tasksByDay}
                onToggleTask={toggleTask}
                onDeleteTask={deleteTask}
                onDeleteEvent={deleteEvent}
                botNameById={botNameById}
              />
            ) : (
              <MonthView
                monthDays={monthDays}
                anchorMonthKey={dayKey.slice(0, 7)}
                selectedDayKey={dayKey}
                weekStartsOn={prefs.week_starts_on}
                eventsByDay={eventsByDay}
                tasksByDay={tasksByDay}
                onToggleTask={toggleTask}
                onDeleteTask={deleteTask}
                onSelectDay={(k) => {
                  setAnchorDayKey(k);
                  setView("day");
                }}
              />
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Daily to-do</div>
                <div className="mt-1 text-xs text-muted-foreground">{formatReadableDateKey(dayKey, tz)}</div>
              </div>

              <button
                onClick={() => setView("day")}
                className="shrink-0 rounded-xl border px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
                type="button"
                title="Open day view"
              >
                Open day
              </button>
            </div>

            {!prefs.show_tasks ? (
              <div className="mt-4 rounded-2xl border bg-muted p-3 text-sm text-muted-foreground">Tasks are hidden.</div>
            ) : (
              <>
                <div className="mt-4 text-xs font-medium text-muted-foreground">Due this day</div>
                {selectedDayTasks.length ? (
                  <div className="mt-2 space-y-2">
                    {selectedDayTasks.map((t: any) => (
                      <div key={t.id} className="rounded-2xl border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            onClick={() => toggleTask(t.id, t.status)}
                            className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left hover:opacity-90"
                            title="Toggle task"
                            type="button"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="font-medium">{t.title}</div>
                                {t.bot_id ? (
                                  <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                                    {botNameById.get(String(t.bot_id)) || "Bot"}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {t.due_at ? `due ${formatDateTime(String(t.due_at), tz)}` : "no due date"}
                              </div>
                            </div>
                            <span className="shrink-0 rounded-full border px-3 py-1 text-xs text-muted-foreground">{t.status}</span>
                          </button>

                          <button
                            onClick={() => deleteTask(t.id)}
                            className="shrink-0 rounded-xl border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Delete task"
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground">No tasks due this day.</div>
                )}

                <div className="mt-5 flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-muted-foreground">No due date</div>
                  <div className="text-[11px] text-muted-foreground">{noDueTasks.length ? `${noDueTasks.length} total` : ""}</div>
                </div>

                {noDueTasks.length ? (
                  <div className="mt-2 space-y-2">
                    {noDueTasks.slice(0, 6).map((t: any) => (
                      <div key={t.id} className="rounded-2xl border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            onClick={() => toggleTask(t.id, t.status)}
                            className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left hover:opacity-90"
                            title="Toggle task"
                            type="button"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="font-medium">{t.title}</div>
                                {t.bot_id ? (
                                  <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                                    {botNameById.get(String(t.bot_id)) || "Bot"}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">no due date</div>
                            </div>
                            <span className="shrink-0 rounded-full border px-3 py-1 text-xs text-muted-foreground">{t.status}</span>
                          </button>

                          <button
                            onClick={() => deleteTask(t.id)}
                            className="shrink-0 rounded-xl border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Delete task"
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    {noDueTasks.length > 6 ? <div className="text-xs text-muted-foreground">+{noDueTasks.length - 6} more</div> : null}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground">No “no due date” tasks.</div>
                )}
              </>
            )}
          </div>

          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <div className="text-sm font-medium">Quick add</div>
            <div className="mt-1 text-xs text-muted-foreground">Manual add is fine. Auto extraction becomes paid-only later.</div>

            <QuickAdd botId={botId} onAdded={() => botId && loadData(botId)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={[
        "rounded-xl border px-3 py-2 text-sm transition-colors",
        checked ? "bg-accent text-foreground" : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      ].join(" ")}
      type="button"
    >
      {label}
    </button>
  );
}

function BotBadge({ botId, botNameById }: { botId?: string; botNameById: Map<string, string> }) {
  if (!botId) return null;
  return (
    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
      {botNameById.get(String(botId)) || "Bot"}
    </span>
  );
}

function DayView({
  dayKey,
  tz,
  events,
  tasks,
  onToggleTask,
  onDeleteTask,
  onDeleteEvent,
  botNameById,
}: {
  dayKey: string;
  tz: string;
  events: (EventRow & { bot_id?: string })[];
  tasks: (TaskRow & { bot_id?: string })[];
  onToggleTask: (id: string, status: "open" | "done") => void;
  onDeleteTask: (id: string) => void;
  onDeleteEvent: (id: string) => void;
  botNameById: Map<string, string>;
}) {
  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">
        Day: <span className="font-mono">{dayKey}</span>
      </div>

      <Section title="Events">
        {events.length ? (
          <div className="space-y-2">
            {events.map((e: any) => (
              <div key={e.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{e.title}</div>
                      <BotBadge botId={e.bot_id} botNameById={botNameById} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground" title={`${e.start_at}${e.end_at ? ` → ${e.end_at}` : ""}`}>
                      {formatDateTime(String(e.start_at), tz)}
                      {e.end_at ? ` → ${formatDateTime(String(e.end_at), tz)}` : ""}
                      {e.location ? ` · ${e.location}` : ""}
                    </div>
                  </div>

                  <button
                    onClick={() => onDeleteEvent(e.id)}
                    className="rounded-xl border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Delete event"
                    type="button"
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
            {tasks.map((t: any) => (
              <div key={t.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => onToggleTask(t.id, t.status)}
                    className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left hover:opacity-90"
                    title="Toggle task"
                    type="button"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{t.title}</div>
                        <BotBadge botId={t.bot_id} botNameById={botNameById} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t.due_at ? `due ${formatDateTime(String(t.due_at), tz)}` : "no due date"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border px-3 py-1 text-xs text-muted-foreground">{t.status}</span>
                  </button>

                  <button
                    onClick={() => onDeleteTask(t.id)}
                    className="shrink-0 rounded-xl border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Delete task"
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
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
  tz,
  eventsByDay,
  tasksByDay,
  onToggleTask,
  onDeleteTask,
  onDeleteEvent,
  botNameById,
}: {
  weekDays: string[];
  tz: string;
  eventsByDay: Map<string, (EventRow & { bot_id?: string })[]>;
  tasksByDay: Map<string, (TaskRow & { bot_id?: string })[]>;
  onToggleTask: (id: string, status: "open" | "done") => void;
  onDeleteTask: (id: string) => void;
  onDeleteEvent: (id: string) => void;
  botNameById: Map<string, string>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {weekDays.map((k) => {
        const ev = eventsByDay.get(k) || [];
        const tk = tasksByDay.get(k) || [];
        return (
          <div key={k} className="rounded-2xl border p-4">
            <div className="font-medium">{k}</div>

            <div className="mt-3 text-xs font-medium text-muted-foreground">Events</div>
            {ev.length ? (
              <div className="mt-2 space-y-2">
                {ev.slice(0, 4).map((e: any) => (
                  <div key={e.id} className="rounded-xl border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-medium">{e.title}</div>
                          <BotBadge botId={e.bot_id} botNameById={botNameById} />
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground" title={e.start_at}>
                          {formatDateTime(String(e.start_at), tz)}
                        </div>
                      </div>
                      <button
                        onClick={() => onDeleteEvent(e.id)}
                        className="shrink-0 rounded-lg border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Delete event"
                        type="button"
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
                {tk.slice(0, 4).map((t: any) => (
                  <div key={t.id} className="rounded-xl border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => onToggleTask(t.id, t.status)}
                        className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:opacity-90"
                        title="Toggle task"
                        type="button"
                      >
                        <span className="inline-flex items-center gap-2">
                          {t.title}
                          <BotBadge botId={t.bot_id} botNameById={botNameById} />
                        </span>
                      </button>
                      <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{t.status}</span>
                      <button
                        onClick={() => onDeleteTask(t.id)}
                        className="shrink-0 rounded-lg border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Delete task"
                        type="button"
                      >
                        Del
                      </button>
                    </div>
                  </div>
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
  anchorMonthKey,
  selectedDayKey,
  weekStartsOn,
  eventsByDay,
  tasksByDay,
  onToggleTask,
  onDeleteTask,
  onSelectDay,
}: {
  monthDays: string[];
  anchorMonthKey: string; // YYYY-MM
  selectedDayKey: string;
  weekStartsOn: "sun" | "mon";
  eventsByDay: Map<string, (EventRow & { bot_id?: string })[]>;
  tasksByDay: Map<string, (TaskRow & { bot_id?: string })[]>;
  onToggleTask: (id: string, status: "open" | "done") => void;
  onDeleteTask: (id: string) => void;
  onSelectDay: (dayKey: string) => void;
}) {
  const labels = weekdayLabels(weekStartsOn);
  const weeks = Math.ceil(monthDays.length / 7);

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

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
        {monthDays.map((k) => {
          const ev = eventsByDay.get(k) || [];
          const tk = tasksByDay.get(k) || [];
          const inMonth = sameMonthByKey(k, `${anchorMonthKey}-01`);
          const isToday = k === todayKey;
          const isSelected = k === selectedDayKey;

          return (
            <button
              key={k}
              onClick={() => onSelectDay(k)}
              className={[
                "min-h-[110px] rounded-2xl border p-2 text-left transition-colors hover:bg-accent/40",
                inMonth ? "bg-background/40" : "bg-muted/30 opacity-70",
                isSelected ? "ring-2 ring-ring" : "",
              ].join(" ")}
              title="Open day"
              type="button"
            >
              <div className="flex items-center justify-between">
                <div className={["text-xs font-medium", isToday ? "rounded-md border bg-background px-2 py-0.5" : ""].join(" ")}>
                  {Number(k.slice(8, 10))}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {ev.length ? `${ev.length}e` : ""}
                  {ev.length && tk.length ? " · " : ""}
                  {tk.length ? `${tk.length}t` : ""}
                </div>
              </div>

              <div className="mt-2 space-y-1">
                {ev.slice(0, 2).map((e: any) => (
                  <div key={e.id} className="truncate rounded-lg border px-2 py-1 text-xs" title={e.title}>
                    {e.title}
                  </div>
                ))}
                {tk.slice(0, 2).map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
                    <button
                      onClick={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onToggleTask(t.id, t.status);
                      }}
                      className="min-w-0 flex-1 truncate text-left hover:opacity-90"
                      title="Toggle task"
                      type="button"
                    >
                      {t.title}
                    </button>
                    <button
                      onClick={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onDeleteTask(t.id);
                      }}
                      className="shrink-0 rounded-md border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Delete task"
                      type="button"
                    >
                      Del
                    </button>
                  </div>
                ))}
                {ev.length + tk.length > 4 ? <div className="text-[11px] text-muted-foreground">+{ev.length + tk.length - 4} more</div> : null}
              </div>
            </button>
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
    if (!botId || botId === ALL_BOTS_ID) return;
    if (!title.trim()) return;
    if (mode === "event" && !when.trim()) return;

    setLoading(true);
    try {
      if (mode === "event") {
        await fetchJson("/api/schedule/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bot_id: botId, title: title.trim(), start_at: when.trim() }),
          credentials: "include",
        });
      } else {
        await fetchJson("/api/schedule/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bot_id: botId, title: title.trim(), due_at: when.trim() ? when.trim() : null }),
          credentials: "include",
        });
      }

      setTitle("");
      setWhen("");
      onAdded();
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (isFetchJsonError(e) && e.status === 403) {
        window.location.href = "/billing";
        return;
      }
      console.error(e);
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
              "flex-1 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-60",
              mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
            type="button"
            disabled={loading}
          >
            {m === "event" ? "Event" : "Task"}
          </button>
        ))}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={mode === "event" ? "Event title" : "Task title"}
        className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        disabled={loading}
      />

      <input
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        placeholder={mode === "event" ? "Start at (ISO string)" : "Due at (ISO or blank)"}
        className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        disabled={loading}
      />

      <button
        onClick={submit}
        disabled={loading || !botId || botId === ALL_BOTS_ID}
        className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        type="button"
      >
        {botId === ALL_BOTS_ID ? "Select a bot to add" : loading ? "Adding…" : "Add"}
      </button>

      <div className="rounded-2xl border bg-muted p-3 text-xs text-muted-foreground">
        Tip: use ISO like <span className="font-mono">2026-02-10T14:00:00Z</span>
      </div>
    </div>
  );
}