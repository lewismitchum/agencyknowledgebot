// app/(app)/app/email/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type Bot = {
  id: string;
  name: string;
  owner_user_id?: string | null;
};

type Draft = { subject: string; body: string };

type DraftRow = {
  id: string;
  bot_id: string;
  subject: string;
  created_at: string;
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function shortText(s: string, max = 80) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(10, max - 12)) + "…" + t.slice(-10);
}

export default function EmailPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState("");

  const [tone, setTone] = useState("direct");
  const [recipientName, setRecipientName] = useState("");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [prompt, setPrompt] = useState("");

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [fallback, setFallback] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [openingDraft, setOpeningDraft] = useState(false);
  const [openDraftError, setOpenDraftError] = useState("");

  const canDraft = useMemo(() => {
    return botId.trim().length > 0 && prompt.trim().length > 0 && !drafting;
  }, [botId, prompt, drafting]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGated(false);
      setError("");

      try {
        const j = await fetchJson<any>("/api/email", { credentials: "include", cache: "no-store" });
        if (cancelled) return;

        setPlan(typeof j?.plan === "string" ? j.plan : undefined);
        setUpsell(j?.upsell ?? null);

        const allowed = Boolean(j?.ok) && !j?.upsell?.code;
        setGated(!allowed);

        if (allowed) {
          try {
            const b = await fetchJson<any>("/api/bots", { credentials: "include", cache: "no-store" });
            const list = Array.isArray(b?.bots) ? b.bots : Array.isArray(b) ? b : [];
            const parsed: Bot[] = list
              .map((x: any) => ({
                id: String(x?.id || ""),
                name: String(x?.name || "Bot"),
                owner_user_id: x?.owner_user_id ?? null,
              }))
              .filter((x: Bot) => x.id);

            if (cancelled) return;

            setBots(parsed);

            if (!botId) {
              const agency = parsed.find((x) => !x.owner_user_id) ?? parsed[0];
              if (agency?.id) setBotId(agency.id);
            }
          } catch {
            if (!cancelled) setBots([]);
          }

          // load drafts list
          try {
            setDraftsLoading(true);
            setDraftsError("");

            const d = await fetchJson<any>("/api/email/drafts", { credentials: "include", cache: "no-store" });
            if (cancelled) return;

            setDrafts(Array.isArray(d?.drafts) ? (d.drafts as DraftRow[]) : []);
          } catch (e: any) {
            if (cancelled) return;
            setDraftsError(e?.message ?? "Failed to load drafts");
          } finally {
            if (!cancelled) setDraftsLoading(false);
          }
        }
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e) && e.status === 401) {
          window.location.href = "/login";
          return;
        }

        setError(e?.message ?? "Failed to load email");
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

  async function refreshDrafts() {
    try {
      const d = await fetchJson<any>("/api/email/drafts", { credentials: "include", cache: "no-store" });
      setDrafts(Array.isArray(d?.drafts) ? (d.drafts as DraftRow[]) : []);
    } catch {
      // ignore
    }
  }

  async function onOpenDraft(id: string) {
    const draftId = String(id || "").trim();
    if (!draftId) return;

    setSelectedDraftId(draftId);
    setOpeningDraft(true);
    setOpenDraftError("");

    try {
      const j = await fetchJson<any>(`/api/email/drafts/${encodeURIComponent(draftId)}`, {
        credentials: "include",
        cache: "no-store",
      });

      const subj = String(j?.draft?.subject || "").trim();
      const body = String(j?.draft?.body || "").trim();

      if (!subj || !body) {
        setOpenDraftError("Could not open draft.");
        return;
      }

      setDraft({ subject: subj, body });
      setFallback(null);
      setDraftError("");
    } catch (e: any) {
      if (isFetchJsonError(e) && e.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (isFetchJsonError(e) && e.status === 404) {
        setOpenDraftError("Draft not found.");
        return;
      }
      setOpenDraftError(e?.message ?? "Failed to open draft");
    } finally {
      setOpeningDraft(false);
    }
  }

  async function onDraft() {
    if (!canDraft) return;

    setDrafting(true);
    setDraftError("");
    setFallback(null);
    setDraft(null);
    setSelectedDraftId(null);
    setOpenDraftError("");

    try {
      const j = await fetchJson<any>("/api/email/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_id: botId,
          prompt,
          tone,
          recipient: { name: recipientName, company: recipientCompany },
        }),
      });

      if (j?.fallback) {
        setFallback(String(j?.message || "I don’t have that information in the docs yet."));
        return;
      }

      if (!j?.draft?.subject || !j?.draft?.body) {
        setFallback("I don’t have that information in the docs yet.");
        return;
      }

      setDraft({ subject: String(j.draft.subject), body: String(j.draft.body) });

      await refreshDrafts();
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setDraftError("Upgrade required to use Email drafting.");
          return;
        }
        if (e.status === 409) {
          setDraftError("This bot is missing a vector store. Repair it in Bots first.");
          return;
        }
      }
      setDraftError(e?.message ?? "Failed to draft email");
    } finally {
      setDrafting(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Email is available on Corporation"
          message={upsell?.message || "Upgrade to unlock the email inbox + docs-backed drafting."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Email</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Docs-backed email drafting (strict). Plan: <span className="font-mono">{plan ?? "unknown"}</span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
            <div>
              <div className="text-base font-semibold">Draft from docs</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Louis will only draft if file_search finds evidence. Otherwise you get the fallback.
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium">Bot</div>
                <select
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                >
                  {bots.length === 0 ? <option value="">No bots found</option> : null}
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.owner_user_id ? " (Private)" : " (Agency)"}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-muted-foreground">Drafting uses this bot’s vector store.</div>
              </div>

              <div>
                <div className="text-sm font-medium">Tone</div>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                >
                  <option value="friendly">friendly</option>
                  <option value="direct">direct</option>
                  <option value="formal">formal</option>
                </select>
                <div className="mt-2 text-xs text-muted-foreground">Controls voice. Facts still must come from docs.</div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium">Recipient name (optional)</div>
                <input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  placeholder="Jamie"
                />
              </div>
              <div>
                <div className="text-sm font-medium">Recipient company (optional)</div>
                <input
                  value={recipientCompany}
                  onChange={(e) => setRecipientCompany(e.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
                  placeholder="Acme Co"
                />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">What email do you need?</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
                placeholder='Example: "Draft a follow-up to the client about the onboarding kickoff. Use our onboarding SOP + timeline."'
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onDraft}
                disabled={!canDraft}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {drafting ? "Drafting..." : "Draft email"}
              </button>

              <div className="text-xs text-muted-foreground">Strict docs-only for internal facts.</div>
            </div>

            {draftError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{draftError}</div>
            ) : null}

            {fallback ? <div className="rounded-xl border bg-muted/40 p-3 text-sm font-mono">{fallback}</div> : null}

            {draft ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    Draft {selectedDraftId ? <span className="text-xs text-muted-foreground">(opened)</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => navigator.clipboard?.writeText(draft.subject).catch(() => {})}
                    >
                      Copy subject
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => navigator.clipboard?.writeText(draft.body).catch(() => {})}
                    >
                      Copy body
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border bg-background/40 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</div>
                  <div className="mt-1">{draft.subject}</div>
                </div>

                <div className="rounded-xl border bg-background/40 p-3 text-sm whitespace-pre-wrap">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Body</div>
                  <div className="mt-2">{draft.body}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-3">
            <div className="text-base font-semibold">Recent drafts</div>

            {draftsLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : draftsError ? (
              <div className="text-sm text-red-600">{draftsError}</div>
            ) : drafts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No drafts yet.</div>
            ) : (
              <div className="space-y-2">
                {openDraftError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {openDraftError}
                  </div>
                ) : null}

                {drafts.slice(0, 12).map((d) => {
                  const active = selectedDraftId === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onOpenDraft(d.id)}
                      disabled={openingDraft && active}
                      className={[
                        "w-full text-left rounded-xl border bg-background/40 p-3 transition",
                        active ? "border-primary/40 bg-primary/5" : "hover:bg-muted",
                      ].join(" ")}
                      title={d.subject}
                    >
                      <div className="text-xs text-muted-foreground">
                        {new Date(d.created_at).toLocaleString()}
                        {active && openingDraft ? " • Opening…" : ""}
                      </div>
                      <div className="mt-1 text-sm font-medium">{shortText(d.subject, 72)}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground font-mono">{d.id}</div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Next: Inbox + threads (corp). This is just docs-backed drafting + history.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}