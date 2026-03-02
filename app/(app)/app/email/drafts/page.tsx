// app/(app)/app/email/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type DraftRow = {
  id: string;
  subject: string;
  created_at?: string;
  updated_at?: string;
};

type OpenDraft = {
  id: string;
  subject: string;
  body: string;
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function shortText(s: string, max = 84) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(10, max - 12)) + "…" + t.slice(-10);
}

function safeDateLabel(s?: string) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function EmailDraftsPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const [error, setError] = useState("");

  const [connected, setConnected] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");

  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState("");
  const [openDraft, setOpenDraft] = useState<OpenDraft | null>(null);

  const filteredDrafts = useMemo(() => {
    const query = String(qApplied || "").trim().toLowerCase();
    if (!query) return drafts;
    return drafts.filter((d) => {
      const hay = `${d.subject || ""}`.toLowerCase();
      return hay.includes(query);
    });
  }, [drafts, qApplied]);

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
          const isConnected = Boolean(j?.connected);
          setConnected(isConnected);
          setProvider(j?.provider ?? null);
          setEmail(j?.email ?? null);
          setMessage(String(j?.message || ""));

          if (isConnected) {
            await loadDraftsInternal(30);
          }
        }
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load drafts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDraftsInternal(max = 30, nextQ?: string) {
    if (!connected) return;

    setDraftsLoading(true);
    setDraftsError("");
    setDrafts([]);

    try {
      const query = String(nextQ ?? qApplied ?? "").trim();
      const url = query
        ? `/api/email/drafts?max=${encodeURIComponent(String(max))}&q=${encodeURIComponent(query)}`
        : `/api/email/drafts?max=${encodeURIComponent(String(max))}`;

      const j = await fetchJson<any>(url, { credentials: "include", cache: "no-store" });
      const rows = Array.isArray(j?.drafts) ? (j.drafts as DraftRow[]) : [];
      setDrafts(rows);

      if (!openId && rows[0]?.id) {
        await openDraftById(rows[0].id);
      }
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 409) {
          setDraftsError("Not connected. Click Connect Gmail.");
          return;
        }
      }
      setDraftsError(e?.message ?? "Failed to load drafts");
    } finally {
      setDraftsLoading(false);
    }
  }

  async function reloadDrafts() {
    await loadDraftsInternal(30);
  }

  async function openDraftById(id: string) {
    const did = String(id || "").trim();
    if (!did) return;

    setOpenId(did);
    setOpenLoading(true);
    setOpenError("");
    setOpenDraft(null);

    try {
      const j = await fetchJson<any>(`/api/email/drafts/${encodeURIComponent(did)}`, {
        credentials: "include",
        cache: "no-store",
      });

      const subj = String(j?.draft?.subject || j?.subject || "").trim();
      const body = String(j?.draft?.body || j?.body || "").trim();

      if (!subj && !body) throw new Error("Missing draft");

      setOpenDraft({
        id: did,
        subject: subj || "(no subject)",
        body: body || "",
      });
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
        if (e.status === 404) {
          setOpenError("Draft not found.");
          return;
        }
      }
      setOpenError(e?.message ?? "Failed to open draft");
    } finally {
      setOpenLoading(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (upsell?.code) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Email is available on Corporation"
          message={upsell?.message || "Upgrade to unlock Gmail connection + drafts."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Email Drafts</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-0px)] w-full">
      <div className="flex h-full">
        {/* Left rail */}
        <aside className="hidden w-[260px] shrink-0 border-r bg-card md:flex md:flex-col">
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold">Email</div>
              <div className="text-[11px] text-muted-foreground font-mono">{plan ?? "unknown"}</div>
            </div>

            <a
              href="/app/email"
              className="mt-3 block w-full rounded-2xl bg-foreground px-4 py-3 text-left text-sm font-semibold text-background shadow-sm hover:opacity-95"
              title="Compose"
            >
              Compose
              <div className="mt-1 text-[11px] font-normal text-background/80">AI can help write</div>
            </a>
          </div>

          <div className="px-3 pb-3">
            <div className="rounded-2xl border bg-background/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connection</div>
              {connected ? (
                <div className="mt-2 text-[12px] text-muted-foreground">
                  <div>
                    Provider: <span className="font-mono">{provider ?? "gmail"}</span>
                  </div>
                  <div className="mt-1 truncate">
                    Mailbox: <span className="font-mono">{email ?? "—"}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-[12px] text-muted-foreground">{message || "Not connected."}</div>
              )}

              <div className="mt-3 flex items-center gap-2">
                {connected ? (
                  <button
                    type="button"
                    onClick={() => reloadDrafts().catch(() => {})}
                    disabled={draftsLoading}
                    className="w-full rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    {draftsLoading ? "Loading…" : "Refresh"}
                  </button>
                ) : (
                  <a
                    href="/api/email/connect"
                    className="w-full rounded-xl bg-foreground px-3 py-2 text-center text-xs font-medium text-background"
                  >
                    Connect Gmail
                  </a>
                )}
              </div>
            </div>
          </div>

          <nav className="flex-1 px-3 pb-4 pt-3">
            <a className="block rounded-xl px-3 py-2 text-sm hover:bg-muted/60" href="/app/email">
              Inbox
            </a>
            <div className="mt-1 rounded-xl bg-muted px-3 py-2 text-sm font-medium">Drafts</div>
          </nav>
        </aside>

        {/* Main column */}
        <div className="flex h-full flex-1 flex-col">
          {/* Top bar */}
          <header className="border-b bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="md:hidden">
                <div className="text-base font-semibold">Email</div>
                <div className="text-[11px] text-muted-foreground font-mono">{plan ?? "unknown"}</div>
              </div>

              <div className="flex flex-1 items-center gap-2">
                <div className="flex flex-1 items-center rounded-2xl border bg-background/40 px-3">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const next = String(q || "").trim();
                        setQApplied(next);
                        loadDraftsInternal(30, next).catch(() => {});
                      }
                    }}
                    placeholder="Search drafts"
                    className="h-10 w-full bg-transparent text-sm outline-none"
                    disabled={!connected}
                  />
                  <button
                    type="button"
                    className="rounded-xl px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60"
                    onClick={() => {
                      const next = String(q || "").trim();
                      setQApplied(next);
                      loadDraftsInternal(30, next).catch(() => {});
                    }}
                    disabled={!connected}
                  >
                    Search
                  </button>
                </div>

                <a href="/app/email" className="rounded-xl border px-3 py-2 text-sm hover:bg-muted">
                  Inbox
                </a>
              </div>
            </div>
          </header>

          {/* 2-pane like Gmail drafts */}
          <div className="flex flex-1 overflow-hidden">
            {/* Draft list */}
            <section className="w-[360px] shrink-0 border-r bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="text-sm font-semibold">Drafts</div>
                <button
                  type="button"
                  onClick={() => reloadDrafts().catch(() => {})}
                  disabled={!connected || draftsLoading}
                  className="rounded-xl border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                >
                  Reload
                </button>
              </div>

              {!connected ? (
                <div className="p-4">
                  <div className="rounded-2xl border bg-background/40 p-4 text-sm text-muted-foreground">
                    {message || "Connect Gmail to view drafts."}
                  </div>
                  <a
                    href="/api/email/connect"
                    className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background"
                  >
                    Connect Gmail
                  </a>
                </div>
              ) : (
                <div className="flex-1 overflow-auto p-2">
                  {draftsLoading ? (
                    <div className="p-3 text-sm text-muted-foreground">Loading…</div>
                  ) : draftsError ? (
                    <div className="m-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {draftsError}
                    </div>
                  ) : filteredDrafts.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No drafts found.</div>
                  ) : (
                    <div className="space-y-1">
                      {filteredDrafts.map((d) => {
                        const active = openId === d.id;
                        const ts = d.updated_at || d.created_at || "";
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => openDraftById(d.id).catch(() => {})}
                            className={cx(
                              "w-full rounded-2xl border px-3 py-3 text-left transition",
                              active ? "border-primary/40 bg-primary/5" : "bg-background/40 hover:bg-muted",
                            )}
                            title={d.subject || d.id}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="truncate text-[12px] text-muted-foreground">Draft</div>
                              <div className="shrink-0 text-[11px] text-muted-foreground">{ts ? safeDateLabel(ts) : ""}</div>
                            </div>
                            <div className="mt-1 truncate text-sm font-medium">{shortText(d.subject || "(no subject)", 72)}</div>
                            <div className="mt-1 truncate text-[11px] font-mono text-muted-foreground">{d.id}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Draft view */}
            <main className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {shortText(openDraft?.subject || (openId ? "Draft" : "Select a draft"), 96)}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {openId ? `draft_id: ${openId}` : connected ? "Pick a draft to preview." : "Connect Gmail first."}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="/app/email"
                    className={cx(
                      "rounded-xl border px-3 py-2 text-xs hover:bg-muted",
                      !openId ? "pointer-events-none opacity-60" : "",
                    )}
                    title="Edit in Compose"
                  >
                    Edit (Compose)
                  </a>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-6">
                {openError ? (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{openError}</div>
                ) : null}

                {openLoading ? (
                  <div className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">Opening draft…</div>
                ) : !openDraft ? (
                  <div className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">
                    {connected ? "Select a draft." : "Connect Gmail to view drafts."}
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-4">
                    <div className="rounded-3xl border bg-card p-6 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</div>
                      <div className="mt-2 text-sm">{openDraft.subject || "(no subject)"}</div>
                    </div>

                    <div className="rounded-3xl border bg-card p-6 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Body</div>
                      <div className="mt-3 whitespace-pre-wrap text-sm">{openDraft.body || ""}</div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(openDraft.body || "").catch(() => {})}
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                      >
                        Copy body
                      </button>

                      <a href="/app/email" className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background">
                        Compose new
                      </a>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Next: compose modal (Gmail-style) + draft autosave.
                    </div>
                  </div>
                )}
              </div>
            </main>
          </div>

          {/* Mobile nav */}
          <div className="border-t bg-card p-3 md:hidden">
            <div className="grid grid-cols-2 gap-2">
              <a href="/app/email" className="rounded-xl border px-3 py-2 text-center text-sm hover:bg-muted">
                Inbox
              </a>
              <a href="/app/email" className="rounded-xl border px-3 py-2 text-center text-sm hover:bg-muted">
                Compose
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}