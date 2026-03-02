// app/(app)/app/email/inbox/page.tsx
"use client";

import { useEffect, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

export default function EmailInboxPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string>("");

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
          <div className="rounded-xl border bg-background/40 p-3 text-sm">
            Connected. (Threads + actions coming next.)
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border bg-background/40 p-3 text-sm">
              <div className="text-sm font-medium">Not connected yet</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {message || "Gmail OAuth + thread list is coming next."}
              </div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
              <div className="font-medium">Coming next</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                <li>Connect Gmail (OAuth)</li>
                <li>Thread list + search</li>
                <li>Open thread + summarize</li>
                <li>Draft reply using docs-backed evidence (same strict rules)</li>
                <li>Send + log drafts/actions</li>
              </ul>
            </div>

            <button
              type="button"
              disabled
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background opacity-60"
              title="Gmail connection coming next"
            >
              Connect Gmail (coming soon)
            </button>
          </div>
        )}
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-sm space-y-3">
        <div className="text-base font-semibold">Drafting</div>
        <div className="text-sm text-muted-foreground">
          Drafting works now (docs-backed). Use the Draft page.
        </div>
        <a className="inline-flex rounded-xl border px-4 py-2 text-sm hover:bg-muted" href="/app/email">
          Go to Drafting
        </a>
      </div>
    </div>
  );
}