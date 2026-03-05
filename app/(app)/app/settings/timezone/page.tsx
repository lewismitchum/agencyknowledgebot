// app/(app)/app/settings/timezone/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ApiResp =
  | { ok: true; timezone: string; role?: string | null; status?: string | null }
  | { ok?: false; error?: string; message?: string; timezone?: string };

type MeResp =
  | {
      ok: true;
      user: { id: string; role?: string | null; status?: string | null };
      agency: { id: string; plan?: string | null };
      plan?: string;
    }
  | { ok?: false; error?: string; message?: string };

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
  "Europe/Dublin",
  "Europe/Warsaw",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
];

export default function TimezoneSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");

  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [timezone, setTimezone] = useState<string>("America/Chicago");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isOwner = String(role || "").toLowerCase() === "owner";
  const isActive = String(status || "").toLowerCase() === "active";

  const tzPreview = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date());
    } catch {
      return "Invalid timezone";
    }
  }, [timezone]);

  async function load() {
    setLoading(true);
    setBootError("");
    setError("");

    try {
      // load role/status (owner-only UI)
      const meRes = await fetch("/api/me", {
        credentials: "include",
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });

      if (meRes.status === 401) {
        window.location.href = "/login";
        return;
      }

      const meJson = (await meRes.json().catch(() => null)) as MeResp | null;
      if (meRes.ok && (meJson as any)?.ok) {
        setRole(String((meJson as any)?.user?.role ?? "") || null);
        setStatus(String((meJson as any)?.user?.status ?? "") || null);
      }

      const r = await fetch("/api/settings/timezone", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = (await r.json().catch(() => null)) as ApiResp | null;

      if (!r.ok || !j?.ok) {
        const msg = String((j as any)?.error || (j as any)?.message || `Failed (${r.status})`);
        setBootError(msg);
        return;
      }

      if (j.timezone) setTimezone(String(j.timezone));
    } catch (e: any) {
      setBootError(e?.message || "Failed to load timezone");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!isOwner || !isActive || saving) return;

    setSaving(true);
    setError("");

    try {
      const r = await fetch("/api/settings/timezone", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = (await r.json().catch(() => null)) as ApiResp | null;

      if (!r.ok || !j?.ok) {
        throw new Error(String((j as any)?.error || (j as any)?.message || `Failed (${r.status})`));
      }

      if (j.timezone) setTimezone(String(j.timezone));
    } catch (e: any) {
      setError(e?.message || "Failed to save timezone");
    } finally {
      setSaving(false);
    }
  }

  const canEdit = isOwner && isActive;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Timezone</h1>
          <p className="mt-2 text-muted-foreground">Workspace timezone used for schedule + daily limit day keys.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/app/settings">Back to settings</Link>
          </Button>
        </div>
      </div>

      {bootError ? (
        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Error</div>
          <div className="mt-1 text-muted-foreground">{bootError}</div>
          <div className="mt-3 flex gap-2">
            <Button className="rounded-full" onClick={load} disabled={loading}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Workspace timezone</CardTitle>
          <CardDescription>Preview: {tzPreview}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full">
              Role: {role || "member"}
            </Badge>
            <Badge variant="secondary" className="rounded-full">
              Status: {status || "—"}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              Current: {timezone}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring md:w-[340px]"
              disabled={!canEdit || saving}
            >
              {COMMON_TZ.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>

            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Or type IANA timezone (e.g. America/Chicago)"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              disabled={!canEdit || saving}
            />

            <Button className="rounded-full" onClick={save} disabled={!canEdit || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>

          {!canEdit ? (
            <div className="text-xs text-muted-foreground">Owner + Active only can change timezone.</div>
          ) : null}

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}