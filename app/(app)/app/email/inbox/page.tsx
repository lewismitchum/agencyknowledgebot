// app/(app)/app/email/inbox/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type ThreadRow = {
  id: string;
  subject: string;
  last_from: string;
  last_snippet: string;
  messages_count: number;
};

type ThreadMessage = {
  id: string;
  internalDate: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
};

type Thread = {
  id: string;
  subject: string;
  last_from: string;
  last_snippet: string;
  messages: ThreadMessage[];
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

export default function EmailInboxPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const [error, setError] = useState("");

  const [connected, setConnected] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [threads, setThreads] = useState<ThreadRow[]>([]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState("");
  const [openThread, setOpenThread] = useState<Thread | null>(null);

  const canLoadThreads = useMemo(() => connected && !threadsLoading, [connected, threadsLoading]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const j = await fetchJson<any>("/api/email/inbox", { credentials: "include", cache: "no-store" });
        if (cancelled) return;

        setPlan(typeof j?.plan === "string" ? j.plan : undefined);
        setUpsell(j?.upsell ?? null);

        if (j?.ok) {
          setConnected(Boolean(j?.connected));
          setProvider(j?.provider ?? null);
          setEmail(j?.email ?? null);
          setMessage(String(j?.message || ""));
        }
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load inbox");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadThreads() {
    if (!connected) return;

    setThreadsLoading(true);
    setThreadsError("");
    setThreads([]);

    try {
      const j = await fetchJson<any>("/api/email/threads?max=15", { credentials: "include", cache: "no-store" });
      setThreads(Array.isArray(j?.threads) ? (j.threads as ThreadRow[]) : []);
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 409) {
          setThreadsError("Not connected. Click Connect Gmail.");
          return;
        }
      }
      setThreadsError(e?.message ?? "Failed to load threads");
    } finally {
      setThreadsLoading(false);
    }
  }

  async function openThreadById(id: string) {
    const tid = String(id || "").trim();
    if (!tid) return;

    setOpenId(tid);
    setOpenLoading(true);
    setOpenError("");
    setOpenThread(null);

    try {
      const j = await fetchJson<any>(`/api/email/threads/${encodeURIComponent(tid)}`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!j?.thread?.id) throw new Error("Missing thread");
      setOpenThread(j.thread as Thread);
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 409) {
          setOpenError("Not connected. Click Connect Gmail.");
          return;
        }
      }
      setOpenError(e?.message ?? "Failed to open thread");
    } finally {
      setOpenLoading(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (upsell?.code) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Email inbox is available on Corporation"
          message={upsell?.message || "Upgrade to unlock the inbox + Gmail connection."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Email Inbox</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Email Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Corporation feature. Plan: <span className="font-mono">{plan ?? "unknown"}</span>
        </p>
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-3">
        <div className="text-base font-semibold">Connection</div>

        {connected ? (
          <div className="space-y-3">
            <div className="rounded-xl border bg-background/40 p-3 text-sm">
              <div className="text-sm font-medium">Connected</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Provider: <span className="font-mono">{provider ?? "unknown"}</span>
                {email ? (
                  <>
                    {" "}
                    • Mailbox: <span className="font-mono">{email}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadThreads}
                disabled={!canLoadThreads}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {threadsLoading ? "Loading…" : "Load latest threads"}
              </button>

              <a className="rounded-xl border px-4 py-2 text-sm hover:bg-muted" href="/app/email">
                Drafting
              </a>
            </div>

            {threadsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{threadsError}</div>
            ) : null}

            {threads.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border overflow-hidden">
                  <div className="border-b bg-muted/40 px-4 py-2 text-sm font-medium">Threads</div>
                  <div className="max-h-[420px] overflow-auto">
                    {threads.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={[
                          "w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/40",
                          openId === t.id ? "bg-muted/40" : "",
                        ].join(" ")}
                        onClick={() => openThreadById(t.id)}
                      >
                        <div className="text-sm font-medium">{t.subject || "(no subject)"}</div>
                        <div className="mt-1 text-xs text-muted-foreground truncate">{t.last_from}</div>
                        <div className="mt-1 text-xs text-muted-foreground truncate">{t.last_snippet}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border p-4">
                  <div className="text-sm font-semibold">Thread</div>

                  {openLoading ? (
                    <div className="mt-2 text-sm text-muted-foreground">Loading thread…</div>
                  ) : openError ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {openError}
                    </div>
                  ) : openThread ? (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border bg-background/40 p-3">
                        <div className="text-sm font-medium">{openThread.subject}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{openThread.messages.length} messages</div>
                      </div>

                      <div className="max-h-[360px] overflow-auto rounded-xl border">
                        {openThread.messages.map((m) => (
                          <div key={m.id} className="border-b last:border-b-0 p-3">
                            <div className="text-xs text-muted-foreground">{m.date || ""}</div>
                            <div className="mt-1 text-xs">
                              <span className="text-muted-foreground">From:</span> {m.from || "—"}
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">{m.snippet}</div>
                          </div>
                        ))}
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Next step: “Reply draft” button that uses your docs bot (file_search) + thread context.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-muted-foreground">Select a thread.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No threads loaded yet.</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border bg-background/40 p-3 text-sm">
              <div className="text-sm font-medium">Not connected</div>
              <div className="mt-1 text-xs text-muted-foreground">{message || "Click Connect Gmail to enable inbox."}</div>
            </div>

            <a
              href="/api/email/connect"
              className="inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              Connect Gmail
            </a>

            <div className="text-xs text-muted-foreground">
              Read-only for now (threads + snippets). Sending comes after drafting + explicit action.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}