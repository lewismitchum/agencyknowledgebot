"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
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
        const j = await r.json().catch(() => null);
        setEmail(j?.user?.email ?? null);
        setEmailVerified(Boolean(j?.user?.email_verified ?? false));
        setRole(j?.user?.role ?? null);
        setStatus(j?.user?.status ?? null);
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
          <p className="mt-2 text-muted-foreground">
            Account, security, and workspace preferences.
          </p>
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

      {/* Workspace card (owner-only link) */}
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Workspace</CardTitle>
          <CardDescription>Members, roles, and approvals.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Your access</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-full">
                  {loading ? "—" : (role || "member")}
                </Badge>
                <Badge variant={isPending ? "outline" : "secondary"} className="rounded-full">
                  {loading ? "—" : (status || "active")}
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
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            New users should be <span className="font-medium">pending</span> until an owner approves them.
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Account</CardTitle>
          <CardDescription>Your login identity and verification status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Signed in as</div>
              <div className="text-base font-medium">{loading ? "—" : email || "—"}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={emailVerified ? "secondary" : "outline"} className="rounded-full">
                {emailVerified ? "Verified" : "Unverified"}
              </Badge>
              <Button variant="outline" className="rounded-full" onClick={logout}>
                Logout
              </Button>
            </div>
          </div>

          <Separator />

          <div className="rounded-2xl bg-muted p-4">
            <div className="text-sm font-medium">Docs-only rule</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Louis may only answer using uploaded documents. If it’s not present, it replies exactly:
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
