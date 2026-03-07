"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type MeResponse =
  | {
      ok: true;
      agency: { id: string; name: string | null; email: string | null; plan: string };
      user: { id: string; role?: string | null; status?: string | null };
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

const TOUR_KEYS = [
  "louisai_onboarding_started",
  "louisai_onboarding_completed",
  "louisai_onboarding_dismissed",
  "louisai_onboarding_index",
];

const DELETE_ACCOUNT_CONFIRM = "DELETE MY ACCOUNT";
const DELETE_WORKSPACE_CONFIRM = "DELETE WORKSPACE";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");

  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [agencyEmail, setAgencyEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [timezone, setTimezone] = useState<string>("America/Chicago");
  const [tzLoading, setTzLoading] = useState(false);
  const [tzError, setTzError] = useState("");

  const [accountDeletePhrase, setAccountDeletePhrase] = useState("");
  const [workspaceDeletePhrase, setWorkspaceDeletePhrase] = useState("");

  const [accountDeleteLoading, setAccountDeleteLoading] = useState(false);
  const [workspaceDeleteLoading, setWorkspaceDeleteLoading] = useState(false);

  const [accountDeleteError, setAccountDeleteError] = useState("");
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });

        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!r.ok) {
          const raw = await r.text().catch(() => "");
          setBootError(raw || `Failed to load session (${r.status})`);
          return;
        }

        const j = (await r.json().catch(() => null)) as MeResponse | null;
        const ok = Boolean((j as any)?.ok);

        if (!ok) {
          setBootError(String((j as any)?.error || (j as any)?.message || "Failed to load session"));
          return;
        }

        const agency = (j as any).agency || {};
        const user = (j as any).user || {};

        setAgencyName(agency?.name ?? null);
        setAgencyEmail(agency?.email ?? null);
        setPlan(agency?.plan ?? null);

        setUserId(user?.id ?? null);
        setRole(user?.role ?? null);
        setStatus(user?.status ?? null);
      } catch (e: any) {
        setBootError(e?.message || "Failed to load session");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/agency/timezone", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok && j?.timezone) setTimezone(String(j.timezone));
      } catch {}
    })();
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  function restartOnboarding() {
    try {
      for (const key of TOUR_KEYS) {
        window.localStorage.removeItem(key);
      }
    } catch {}

    window.location.href = "/app";
  }

  const isOwner = String(role || "").toLowerCase() === "owner";
  const isPending = String(status || "").toLowerCase() === "pending";

  const tzPreview = useMemo(() => {
    try {
      const s = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date());
      return s;
    } catch {
      return "Invalid timezone";
    }
  }, [timezone]);

  const canDeleteAccount = accountDeletePhrase.trim() === DELETE_ACCOUNT_CONFIRM;
  const canDeleteWorkspace =
    isOwner &&
    (workspaceDeletePhrase.trim() === DELETE_WORKSPACE_CONFIRM ||
      workspaceDeletePhrase.trim() === String(agencyName || "").trim());

  async function saveTimezone() {
    if (!isOwner) return;
    setTzLoading(true);
    setTzError("");

    try {
      const r = await fetch("/api/agency/timezone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ timezone }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.message || j?.error || "Failed to save timezone");
      setTimezone(String(j.timezone || timezone));
    } catch (e: any) {
      setTzError(e?.message || "Failed to save timezone");
    } finally {
      setTzLoading(false);
    }
  }

  async function deleteAccount() {
    if (!canDeleteAccount || accountDeleteLoading) return;

    setAccountDeleteLoading(true);
    setAccountDeleteError("");

    try {
      const r = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: accountDeletePhrase.trim() }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Failed to delete account");
      }

      try {
        for (const key of TOUR_KEYS) {
          window.localStorage.removeItem(key);
        }
      } catch {}

      await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
      window.location.href = "/login";
    } catch (e: any) {
      setAccountDeleteError(e?.message || "Failed to delete account");
    } finally {
      setAccountDeleteLoading(false);
    }
  }

  async function deleteWorkspace() {
    if (!canDeleteWorkspace || workspaceDeleteLoading || !isOwner) return;

    setWorkspaceDeleteLoading(true);
    setWorkspaceDeleteError("");

    try {
      const r = await fetch("/api/workspace/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: workspaceDeletePhrase.trim() }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Failed to delete workspace");
      }

      try {
        for (const key of TOUR_KEYS) {
          window.localStorage.removeItem(key);
        }
      } catch {}

      await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
      window.location.href = "/login";
    } catch (e: any) {
      setWorkspaceDeleteError(e?.message || "Failed to delete workspace");
    } finally {
      setWorkspaceDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-muted-foreground">Account, security, workspace preferences, and onboarding controls.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app" className="rounded-xl border px-4 py-2 text-sm hover:bg-accent">
            Back to dashboard
          </Link>
        </div>
      </div>

      {bootError ? (
        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Session error</div>
          <div className="mt-1 text-muted-foreground">{bootError}</div>
          <div className="mt-3 flex gap-2">
            <Button className="rounded-full" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/login">Back to login</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Workspace</CardTitle>
          <CardDescription>Agency identity, plan, members.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div>
                <div className="text-sm text-muted-foreground">Agency</div>
                <div className="text-base font-medium">{loading ? "—" : agencyName || "—"}</div>
                <div className="text-sm text-muted-foreground">{loading ? "—" : agencyEmail || "—"}</div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  Plan: {loading ? "—" : plan || "free"}
                </Badge>

                <Badge variant="secondary" className="rounded-full">
                  Role: {loading ? "—" : role || "member"}
                </Badge>

                <Badge variant={isPending ? "outline" : "secondary"} className="rounded-full">
                  Status: {loading ? "—" : status || "active"}
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {isOwner ? (
                <Button asChild className="rounded-full">
                  <Link href="/app/settings/members">Manage members</Link>
                </Button>
              ) : (
                <Button className="rounded-full" disabled>
                  Members (owner only)
                </Button>
              )}
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/billing">Billing</Link>
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            New users should be <span className="font-medium">pending</span> until an owner approves them.
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="text-sm font-medium">Workspace timezone</div>
            <div className="text-sm text-muted-foreground">
              Used for daily limits and schedule day keys. Preview: <span className="font-medium">{tzPreview}</span>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring md:w-[320px]"
                disabled={!isOwner || tzLoading}
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
                disabled={!isOwner || tzLoading}
              />

              <Button className="rounded-full" onClick={saveTimezone} disabled={!isOwner || tzLoading}>
                {tzLoading ? "Saving…" : "Save timezone"}
              </Button>
            </div>

            {tzError ? <div className="text-sm text-red-600">{tzError}</div> : null}

            {!isOwner ? <div className="text-xs text-muted-foreground">Owner only can change timezone.</div> : null}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Onboarding</CardTitle>
          <CardDescription>Replay the guided tour and walkthrough whenever you want.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl bg-muted p-4">
            <div className="text-sm font-medium">Restart guided onboarding</div>
            <p className="mt-1 text-sm text-muted-foreground">
              This resets the guided tour progress and sends you back to the dashboard so the onboarding flow starts again.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button className="rounded-full" onClick={restartOnboarding}>
              Restart onboarding
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app">Go to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Account</CardTitle>
          <CardDescription>Your login identity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">User ID</div>
              <div className="text-base font-medium">{loading ? "—" : userId || "—"}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="rounded-full" onClick={logout}>
                Logout
              </Button>
            </div>
          </div>

          <Separator />

          <div className="rounded-2xl bg-muted p-4">
            <div className="text-sm font-medium">Safety fallback</div>
            <p className="mt-1 text-sm text-muted-foreground">
              For internal questions not grounded in docs, Louis replies exactly:
            </p>
            <div className="mt-3 rounded-xl bg-background p-3 font-mono text-sm">I don’t have that information in the docs yet.</div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-destructive/30">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Danger zone</CardTitle>
          <CardDescription>Permanent destructive actions for your account and workspace.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="rounded-2xl border border-destructive/20 p-4">
            <div className="text-sm font-medium">Delete personal account</div>
            <p className="mt-1 text-sm text-muted-foreground">
              This deletes your personal account, private bots, and private documents. You will be logged out immediately.
            </p>

            <div className="mt-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                Type <span className="font-mono font-medium">{DELETE_ACCOUNT_CONFIRM}</span> to confirm.
              </div>
              <input
                value={accountDeletePhrase}
                onChange={(e) => setAccountDeletePhrase(e.target.value)}
                placeholder={DELETE_ACCOUNT_CONFIRM}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                disabled={accountDeleteLoading}
              />
              {accountDeleteError ? <div className="text-sm text-red-600">{accountDeleteError}</div> : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="destructive"
                className="rounded-xl"
                disabled={!canDeleteAccount || accountDeleteLoading}
                onClick={deleteAccount}
              >
                {accountDeleteLoading ? "Deleting account…" : "Delete my account"}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="rounded-2xl border border-destructive/20 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-medium">Delete workspace</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Owner only. This permanently deletes the entire workspace, including users, bots, docs, schedule data, extractions, and related records.
                </p>
              </div>

              <Badge variant={isOwner ? "secondary" : "outline"} className="rounded-full">
                {isOwner ? "Owner enabled" : "Owner only"}
              </Badge>
            </div>

            <div className="mt-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                Type <span className="font-mono font-medium">{DELETE_WORKSPACE_CONFIRM}</span> or the workspace name{" "}
                <span className="font-mono font-medium">{agencyName || "—"}</span>.
              </div>
              <input
                value={workspaceDeletePhrase}
                onChange={(e) => setWorkspaceDeletePhrase(e.target.value)}
                placeholder={agencyName || DELETE_WORKSPACE_CONFIRM}
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                disabled={!isOwner || workspaceDeleteLoading}
              />
              {workspaceDeleteError ? <div className="text-sm text-red-600">{workspaceDeleteError}</div> : null}
              {!isOwner ? <div className="text-xs text-muted-foreground">Only the workspace owner can do this.</div> : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="destructive"
                className="rounded-xl"
                disabled={!canDeleteWorkspace || workspaceDeleteLoading}
                onClick={deleteWorkspace}
              >
                {workspaceDeleteLoading ? "Deleting workspace…" : "Delete workspace"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}