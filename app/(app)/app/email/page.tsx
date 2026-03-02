// app/(app)/app/email/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

type Draft = {
  subject: string;
  body: string;
  tone?: string;
  notes?: string;
  citations?: Array<{ title?: string; snippet?: string }>;
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function EmailPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  // NEW: draft-from-docs composer
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [context, setContext] = useState(""); // what user wants to say / scenario
  const [ask, setAsk] = useState(""); // explicit instruction for what to draft
  const [tone, setTone] = useState<"neutral" | "friendly" | "firm" | "sales" | "support">("neutral");

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [fallback, setFallback] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const canDraft = useMemo(() => {
    const a = ask.trim().length > 0;
    const c = context.trim().length > 0;
    return (a || c) && !drafting;
  }, [ask, context, drafting]);

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
  }, []);

  async function onDraft() {
    if (!canDraft) return;

    setDrafting(true);
    setDraftError("");
    setFallback(null);
    setDraft(null);

    try {
      const j = await fetchJson<any>("/api/email/draft", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim() || null,
          from: from.trim() || null,
          tone,
          context,
          instruction: ask,
        }),
      });

      if (j?.fallback) {
        setFallback(String(j?.message || "I don’t have that information in the docs yet."));
        return;
      }

      const d = j?.draft ?? null;
      if (!d || typeof d?.subject !== "string" || typeof d?.body !== "string") {
        setFallback("I don’t have that information in the docs yet.");
        return;
      }

      setDraft({
        subject: d.subject,
        body: d.body,
        tone: typeof d?.tone === "string" ? d.tone : tone,
        notes: typeof d?.notes === "string" ? d.notes : "",
        citations: Array.isArray(d?.citations) ? d.citations : [],
      });
    } catch (e: any) {
      if (isFetchJsonError(e)) {
        if (e.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (e.status === 403) {
          setDraftError("Upgrade required to draft emails from docs.");
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
          message={upsell?.message || "Upgrade to Corporation to unlock the email inbox + AI triage + drafting."}
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
          Draft emails from docs (safe) — inbox sync comes later. Plan:{" "}
          <span className="font-mono">{plan ?? "unknown"}</span>
        </p>
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
        <div>
          <div className="text-base font-semibold">Draft from docs</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Louis uses docs evidence. If the docs don’t support specifics, you’ll get the fallback.
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-sm font-medium">To (optional)</div>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
              placeholder="client@company.com"
              autoComplete="email"
              inputMode="email"
            />
          </div>

          <div>
            <div className="text-sm font-medium">From (optional)</div>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
              placeholder="you@yourcompany.com"
              autoComplete="email"
              inputMode="email"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-sm font-medium">Tone</div>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as any)}
              className="mt-2 h-11 w-full rounded-xl border bg-background/40 px-3 text-sm"
            >
              <option value="neutral">Neutral</option>
              <option value="friendly">Friendly</option>
              <option value="firm">Firm</option>
              <option value="sales">Sales</option>
              <option value="support">Support</option>
            </select>
          </div>

          <div className="rounded-2xl border bg-background/30 p-4 text-xs text-muted-foreground">
            Tip: include the doc keyword you want Louis to use (e.g. “pricing”, “onboarding SOP”, “SLA”).
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Context (what’s happening)</div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
            placeholder='Example: "Client asked about our onboarding timeline and what we need from them. We want to set expectations and ask for access to X."'
          />
        </div>

        <div>
          <div className="text-sm font-medium">Instruction (what to write)</div>
          <textarea
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border bg-background/40 p-3 text-sm"
            placeholder='Example: "Draft a reply confirming next steps, list required assets, and include our standard timeline + SLA from docs."'
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

          <div className="text-xs text-muted-foreground">Uses your bot’s vector store (docs).</div>
        </div>

        {draftError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{draftError}</div>
        ) : null}

        {fallback ? <div className="rounded-xl border bg-muted/40 p-3 text-sm font-mono">{fallback}</div> : null}
      </div>

      {draft ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Draft</div>
              <div className="text-xs text-muted-foreground">
                Tone: <span className="font-mono">{draft.tone ?? tone}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                onClick={() => {
                  const text = `Subject: ${draft.subject}\n\n${draft.body}`;
                  navigator.clipboard?.writeText(text).catch(() => {});
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
                onClick={() => downloadTextFile("draft-email.txt", `Subject: ${draft.subject}\n\n${draft.body}`)}
              >
                Download
              </button>
            </div>
          </div>

          <div className="rounded-xl border bg-background/40 p-4">
            <div className="text-sm font-medium">Subject</div>
            <div className="mt-1 font-mono text-sm">{draft.subject}</div>

            <div className="mt-4 text-sm font-medium">Body</div>
            <pre className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{draft.body}</pre>
          </div>

          {draft.notes ? <div className="rounded-xl border bg-muted/30 p-3 text-sm">{draft.notes}</div> : null}

          {draft.citations && draft.citations.length ? (
            <div className="rounded-xl border bg-background/30 p-4">
              <div className="text-sm font-medium">Doc evidence (high level)</div>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {draft.citations.slice(0, 6).map((c, idx) => (
                  <li key={idx}>
                    <span className="font-medium text-foreground">{c.title || "Doc"}</span>
                    {c.snippet ? <span className="text-muted-foreground"> — {c.snippet}</span> : null}
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs text-muted-foreground">
                Next: show exact citations/links once we store doc sources in the response.
              </div>
            </div>
          ) : null}

          <div className="text-xs text-muted-foreground">
            Next: connect Gmail/Microsoft and add “Send” + “Reply in thread” while keeping this docs-backed drafting mode.
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="text-base font-semibold">Coming next</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Connect provider (Gmail / Microsoft) + sync</li>
          <li>Inbox list + threads</li>
          <li>AI summary + suggested reply</li>
          <li>“Extract meeting” → schedule</li>
        </ul>

        <div className="mt-4 rounded-2xl border bg-background/50 p-4 text-sm">
          This page is wired + gated. Next step is adding <span className="font-mono">/api/email/draft</span>.
        </div>
      </div>
    </div>
  );
}