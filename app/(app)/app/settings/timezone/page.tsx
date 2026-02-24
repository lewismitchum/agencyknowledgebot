// app/(app)/app/settings/timezone/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const COMMON_TZ = [
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

type ApiResp =
  | { ok: true; timezone: string }
  | { ok?: false; error?: string; message?: string; timezone?: string };

function isValidIanaTimezone(tz: string) {
  const t = String(tz || "").trim();
  if (!t) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export default function TimezoneSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState("America/Chicago");
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const options = useMemo(() => COMMON_TZ, []);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/timezone", { method: "GET" });
        const json = (await res.json().catch(() => null)) as ApiResp | null;
        if (!ok) return;

        const tz = json && (json as any).timezone ? String((json as any).timezone) : "America/Chicago";
        setTimezone(tz);
        setCustom("");
      } catch (e: any) {
        if (!ok) return;
        setMsg(String(e?.message ?? e));
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  async function save(nextTz: string) {
    setMsg(null);
    const tz = String(nextTz || "").trim();

    if (!isValidIanaTimezone(tz)) {
      setMsg("Invalid timezone (must be a valid IANA timezone like America/Chicago).");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/timezone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });

      const json = (await res.json().catch(() => null)) as ApiResp | null;
      if (!res.ok || !json || (json as any).ok !== true) {
        setMsg((json as any)?.error ? String((json as any).error) : "Failed to save.");
        return;
      }

      setTimezone((json as any).timezone);
      setCustom("");
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Timezone</h1>
        <Link className="text-sm underline opacity-80 hover:opacity-100" href="/app/settings">
          Back
        </Link>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        {loading ? (
          <div className="text-sm opacity-70">Loading…</div>
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <div className="font-medium">Agency timezone</div>
              <div className="mt-1 opacity-70">
                This controls your “daily” usage keys (chats/uploads) and schedule defaults.
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-xs opacity-70">Common timezones</label>
              <select
                className="w-full rounded-xl border bg-background px-3 py-2"
                value={timezone}
                onChange={(e) => {
                  const next = e.target.value;
                  setTimezone(next);
                  setCustom("");
                }}
                disabled={saving}
              >
                {options.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="rounded-xl border px-3 py-2 hover:bg-accent disabled:opacity-50"
                onClick={() => save(timezone)}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save selected"}
              </button>
            </div>

            <div className="rounded-xl border p-3">
              <div className="text-xs font-medium">Custom IANA timezone</div>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  className="flex-1 rounded-xl border bg-background px-3 py-2"
                  placeholder="e.g. Europe/London"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  disabled={saving}
                />
                <button
                  type="button"
                  className="rounded-xl border px-3 py-2 hover:bg-accent disabled:opacity-50"
                  onClick={() => save(custom)}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save custom"}
                </button>
              </div>
              <div className="mt-2 text-xs opacity-70">Must be an IANA timezone name.</div>
            </div>

            {msg ? <div className="text-xs opacity-80">{msg}</div> : null}

            <div className="text-xs opacity-70">
              Current: <span className="font-medium">{timezone}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}