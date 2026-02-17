"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type BotRow = { id: string; name: string };

type ScheduleEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  notes?: string | null;
};

type ScheduleTask = {
  id: string;
  title: string;
  due_at?: string | null;
  status: "open" | "done";
  notes?: string | null;
};

function isoToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function SchedulePage() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [botId, setBotId] = useState("");

  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [loading, setLoading] = useState(false);

  const [evTitle, setEvTitle] = useState("");
  const [evStart, setEvStart] = useState(`${isoToday()}T09:00`);
  const [evEnd, setEvEnd] = useState(`${isoToday()}T10:00`);
  const [evLocation, setEvLocation] = useState("");
  const [evNotes, setEvNotes] = useState("");

  const [tkTitle, setTkTitle] = useState("");
  const [tkDue, setTkDue] = useState("");
  const [tkNotes, setTkNotes] = useState("");

  const selectedBotName = useMemo(
    () => bots.find((b) => b.id === botId)?.name ?? "",
    [bots, botId]
  );

  useEffect(() => {
    (async () => {
      try {
        setBotsLoading(true);
        const r = await fetch("/api/bots", { credentials: "include" });
        const j = await r.json();
        const list: BotRow[] = Array.isArray(j?.bots) ? (j.bots as BotRow[]) : [];
        setBots(list);
        if (!botId && list.length) setBotId(list[0].id);
      } finally {
        setBotsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload() {
    if (!botId) return;
    setLoading(true);
    try {
      const [re, rt] = await Promise.all([
        fetch(`/api/schedule/events?bot_id=${encodeURIComponent(botId)}`, {
          credentials: "include",
        }),
        fetch(`/api/schedule/tasks?bot_id=${encodeURIComponent(botId)}`, {
          credentials: "include",
        }),
      ]);
      const je = await re.json();
      const jt = await rt.json();
      setEvents(Array.isArray(je?.events) ? (je.events as ScheduleEvent[]) : []);
      setTasks(Array.isArray(jt?.tasks) ? (jt.tasks as ScheduleTask[]) : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  async function addEvent() {
    if (!botId) return;
    if (!evTitle.trim()) return;

    const payload = {
      bot_id: botId,
      title: evTitle.trim(),
      starts_at: new Date(evStart).toISOString(),
      ends_at: evEnd ? new Date(evEnd).toISOString() : null,
      location: evLocation.trim() || null,
      notes: evNotes.trim() || null,
    };

    setLoading(true);
    try {
      await fetch("/api/schedule/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setEvTitle("");
      setEvLocation("");
      setEvNotes("");
      await reload();
    } finally {
      setLoading(false);
    }
  }

  async function addTask() {
    if (!botId) return;
    if (!tkTitle.trim()) return;

    const payload = {
      bot_id: botId,
      title: tkTitle.trim(),
      due_at: tkDue ? new Date(tkDue).toISOString() : null,
      notes: tkNotes.trim() || null,
    };

    setLoading(true);
    try {
      await fetch("/api/schedule/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setTkTitle("");
      setTkDue("");
      setTkNotes("");
      await reload();
    } finally {
      setLoading(false);
    }
  }

  async function toggleTask(id: string, next: "open" | "done") {
    setLoading(true);
    try {
      await fetch("/api/schedule/tasks", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      });
      await reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card className="rounded-3xl overflow-hidden">
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl">Schedule</CardTitle>
          <CardDescription>Calendar + To-Do (storage ready; extraction next)</CardDescription>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">
              Bot: {botsLoading ? "Loading…" : selectedBotName || "None"}
            </Badge>

            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={botId}
              disabled={botsLoading || bots.length === 0}
              onChange={(e) => setBotId(e.target.value)}
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            <Button variant="outline" size="sm" onClick={reload} disabled={!botId || loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>

            <div className="ml-auto text-xs text-muted-foreground">
              <Link className="underline" href="/chat">
                Chat
              </Link>
              {" · "}
              <Link className="underline" href="/documents">
                Documents
              </Link>
            </div>
          </div>

          <Separator />
        </CardHeader>

        <CardContent className="grid gap-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Events */}
            <div className="rounded-2xl border p-4 grid gap-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">Events</div>
                <Badge variant="secondary">{events.length}</Badge>
              </div>

              <div className="grid gap-2">
                <Input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder="Event title" />
                <div className="grid grid-cols-2 gap-2">
                  <Input type="datetime-local" value={evStart} onChange={(e) => setEvStart(e.target.value)} />
                  <Input type="datetime-local" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} />
                </div>
                <Input value={evLocation} onChange={(e) => setEvLocation(e.target.value)} placeholder="Location (optional)" />
                <Textarea value={evNotes} onChange={(e) => setEvNotes(e.target.value)} placeholder="Notes (optional)" />
                <Button onClick={addEvent} disabled={!botId || loading || !evTitle.trim()}>
                  Add event
                </Button>
              </div>

              <Separator />

              <div className="grid gap-3">
                {events.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No events yet.</div>
                ) : (
                  events.map((e) => (
                    <div key={e.id} className="rounded-xl border p-3">
                      <div className="font-medium text-sm">{e.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(e.starts_at)}
                        {e.ends_at ? ` → ${fmtDate(e.ends_at)}` : ""}
                      </div>
                      {e.location ? (
                        <div className="text-xs text-muted-foreground">📍 {e.location}</div>
                      ) : null}
                      {e.notes ? (
                        <div className="text-xs text-muted-foreground mt-1">{e.notes}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Tasks */}
            <div className="rounded-2xl border p-4 grid gap-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">To-Do</div>
                <Badge variant="secondary">{tasks.filter((t) => t.status === "open").length} open</Badge>
              </div>

              <div className="grid gap-2">
                <Input value={tkTitle} onChange={(e) => setTkTitle(e.target.value)} placeholder="Task title" />
                <Input type="datetime-local" value={tkDue} onChange={(e) => setTkDue(e.target.value)} />
                <Textarea value={tkNotes} onChange={(e) => setTkNotes(e.target.value)} placeholder="Notes (optional)" />
                <Button onClick={addTask} disabled={!botId || loading || !tkTitle.trim()}>
                  Add task
                </Button>
              </div>

              <Separator />

              <div className="grid gap-3">
                {tasks.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No tasks yet.</div>
                ) : (
                  tasks
                    .slice()
                    .sort((a, b) => {
                      const ad = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
                      const bd = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
                      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
                      return ad - bd;
                    })
                    .map((t) => (
                      <div key={t.id} className="rounded-xl border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{t.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {t.due_at ? `Due: ${fmtDate(t.due_at)}` : "No due date"}
                            </div>
                            {t.notes ? (
                              <div className="text-xs text-muted-foreground mt-1">{t.notes}</div>
                            ) : null}
                          </div>

                          <Button
                            variant={t.status === "done" ? "outline" : "secondary"}
                            size="sm"
                            onClick={() => toggleTask(t.id, t.status === "done" ? "open" : "done")}
                            disabled={loading}
                          >
                            {t.status === "done" ? "Reopen" : "Done"}
                          </Button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Next: wire extraction to auto-create events/tasks from documents.
          </div>
        </CardContent>
      </Card>
    </div>
  );}