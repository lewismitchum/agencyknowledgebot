// app/(app)/app/settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type MeResponse =
  | {
      ok: true;
      agency: { id: string; name: string | null; email: string | null; plan: string };
      user: { id: string };
    }
  | { ok?: false; error?: string; message?: string };

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");

  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [agencyEmail, setAgencyEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  // Optional fields (only show if available)
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { credentials: "include" });
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

        // If your /api/me later includes these, we’ll display them.
        setRole((j as any)?.user?.role ?? null);
        setStatus((j as any)?.user?.status ?? null);
      } catch (e: any) {
        setBootError(e?.message || "Failed to load session");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  const isOwner = role === "owner";
  const isPending = status === "pending";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-muted-foreground">Account, security, and workspace preferences.</p>
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

      {/* Workspace */}
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
                <div className="text-base font-medium">
                  {loading ? "—" : (agencyName || "—")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {loading ? "—" : (agencyEmail || "—")}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  Plan: {loading ? "—" : (plan || "free")}
                </Badge>

                {/* These two are optional until /api/me includes them */}
                <Badge variant="secondary" className="rounded-full">
                  Role: {loading ? "—" : (role || "member")}
                </Badge>
                <Badge variant={isPending ? "outline" : "secondary"} className="rounded-full">
                  Status: {loading ? "—" : (status || "active")}
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
        </CardContent>
      </Card>

      {/* Account */}
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
            <div className="mt-3 rounded-xl bg-background p-3 font-mono text-sm">
              I don’t have that information in the docs yet.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-destructive/30">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Danger zone</CardTitle>
          <CardDescription>These actions are not enabled yet.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">
            Delete workspace, remove documents, and other destructive actions will live here.
          </div>
          <Button variant="destructive" className="rounded-xl" disabled>
            Delete workspace (soon)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}