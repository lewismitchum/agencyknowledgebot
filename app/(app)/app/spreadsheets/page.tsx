// app/(app)/app/spreadsheets/page.tsx
"use client";

import { useEffect, useState } from "react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type Upsell = { code?: string; message?: string };

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && ("status" in e || "code" in e);
}

export default function SpreadsheetsPage() {
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | undefined>(undefined);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGated(false);
      setError("");

      try {
        const j = await fetchJson<any>("/api/spreadsheets", { credentials: "include", cache: "no-store" });

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

        setError(e?.message ?? "Failed to load spreadsheets");
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

  if (gated) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <UpgradeGate
          title="Spreadsheets are available on paid plans"
          message={upsell?.message || "Upgrade to unlock spreadsheet AI updates and extraction."}
          ctaHref="/app/billing"
          ctaLabel="Upgrade Plan"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Spreadsheets</h1>
        <div className="rounded-lg border bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Spreadsheets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI extraction + updates for sheets. Plan: <span className="font-mono">{plan ?? "unknown"}</span>
        </p>
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="text-base font-semibold">Coming next</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Connect Google Sheets (OAuth)</li>
          <li>List connected spreadsheets</li>
          <li>“Update sheet from doc” action</li>
          <li>Audit log of changes</li>
        </ul>

        <div className="mt-4 rounded-2xl border bg-background/50 p-4 text-sm">
          This page is wired + gated. Next step is adding Google OAuth + a first “list sheets” endpoint.
        </div>
      </div>
    </div>
  );
}