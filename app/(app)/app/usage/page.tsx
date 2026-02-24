// app/(app)/app/usage/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type UsageResp = {
  ok: boolean;
  plan: string;
  timezone: string;
  date: string;
  usage: { messages_used: number; uploads_used: number };
  limits: { daily_messages: number; daily_uploads: number | null };
  error?: string;
  message?: string;
};

function fmtLimit(n: number | null) {
  if (n == null) return "Unlimited";
  return String(n);
}

export default function UsagePage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UsageResp | null>(null);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const res = await fetch("/api/usage", { method: "GET" });
        const json = (await res.json().catch(() => null)) as UsageResp | null;
        if (!ok) return;
        setData(json);
      } catch (e: any) {
        if (!ok) return;
        setData({
          ok: false,
          plan: "free",
          timezone: "America/Chicago",
          date: "",
          usage: { messages_used: 0, uploads_used: 0 },
          limits: { daily_messages: 0, daily_uploads: 0 },
          error: "FETCH_FAILED",
          message: String(e?.message ?? e),
        });
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Usage</h1>
        <Link className="text-sm underline opacity-80 hover:opacity-100" href="/app">
          Back
        </Link>
      </div>

      <div className="rounded-xl border bg-background p-4">
        {loading ? (
          <div className="text-sm opacity-70">Loading…</div>
        ) : !data?.ok ? (
          <div className="text-sm">
            <div className="font-medium">Couldn’t load usage.</div>
            <div className="mt-1 opacity-80">
              {data?.error ?? "ERROR"} {data?.message ? `— ${data.message}` : ""}
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div>
                <span className="opacity-70">Plan:</span> <span className="font-medium">{data.plan}</span>
              </div>
              <div>
                <span className="opacity-70">Day key:</span> <span className="font-medium">{data.date}</span>
              </div>
              <div>
                <span className="opacity-70">Timezone:</span> <span className="font-medium">{data.timezone}</span>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="font-medium mb-2">Daily</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="opacity-70">Chats used</div>
                  <div className="text-lg font-semibold">
                    {data.usage.messages_used}{" "}
                    <span className="text-sm font-normal opacity-70">/ {fmtLimit(data.limits.daily_messages)}</span>
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="opacity-70">Uploads used</div>
                  <div className="text-lg font-semibold">
                    {data.usage.uploads_used}{" "}
                    <span className="text-sm font-normal opacity-70">/ {fmtLimit(data.limits.daily_uploads)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="opacity-70 text-xs">
              Note: counts are tracked per agency per local day (based on your agency timezone).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}