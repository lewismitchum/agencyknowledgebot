// app/set-password/page.tsx
"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function SetPasswordInner() {
  const sp = useSearchParams();

  const token = useMemo(() => {
    return (sp.get("token") || sp.get("invite") || sp.get("code") || "").trim();
  }, [sp]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");

    if (!token) {
      setErr("This invite link is missing a token. Ask the owner/admin to resend the invite.");
      return;
    }

    const p = password.trim();
    const c = confirm.trim();

    if (!p) return setErr("Please enter a password.");
    if (p.length < 8) return setErr("Password must be at least 8 characters.");
    if (p !== c) return setErr("Passwords do not match.");

    setBusy(true);
    try {
      const r = await fetchJson("/api/agency/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password: p }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        setErr(String(j?.error || j?.message || `Failed (HTTP ${r.status})`));
        return;
      }

      const redirectTo = String(j?.redirectTo || "/app/chat");
      setOk("Password set. Redirecting…");

      window.location.href = redirectTo;
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Set your password</CardTitle>
              <CardDescription className="mt-1">
                Finish joining the workspace.
              </CardDescription>
            </div>
            <Badge variant="secondary">Louis.Ai</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!token ? (
            <>
              <p className="text-sm text-muted-foreground">
                This invite link is missing a token. Ask the owner/admin to resend the invite.
              </p>
              <div className="flex gap-2">
                <Button asChild variant="secondary">
                  <Link href="/login">Go to login</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/support">Need help?</Link>
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Password</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  type="password"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Confirm password</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  type="password"
                  autoComplete="new-password"
                />
              </div>

              {err ? <p className="text-sm text-destructive">{err}</p> : null}
              {ok ? <p className="text-sm text-muted-foreground">{ok}</p> : null}

              <Button className="w-full" disabled={busy}>
                {busy ? "Saving…" : "Set password and continue"}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <Link className="text-muted-foreground underline" href="/login">
                  Already have an account?
                </Link>
                <Link className="text-muted-foreground underline" href="/support">
                  Need help?
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordInner />
    </Suspense>
  );
}