// app/join/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type AcceptState =
  | { status: "idle" }
  | { status: "missing_token" }
  | { status: "ready" }
  | { status: "submitting" }
  | { status: "success"; agencyName?: string }
  | { status: "error"; message: string };

function AcceptInviteInner() {
  const sp = useSearchParams();

  const token = useMemo(() => {
    return sp.get("token") || sp.get("invite") || sp.get("code") || "";
  }, [sp]);

  const [state, setState] = useState<AcceptState>({ status: "idle" });

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (!token) setState({ status: "missing_token" });
    else setState({ status: "ready" });
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!token) {
      setState({ status: "missing_token" });
      return;
    }

    const p = password.trim();
    const c = confirm.trim();

    if (!p) {
      setState({ status: "error", message: "Please enter a password." });
      return;
    }
    if (p.length < 8) {
      setState({ status: "error", message: "Password must be at least 8 characters." });
      return;
    }
    if (p !== c) {
      setState({ status: "error", message: "Passwords do not match." });
      return;
    }

    setState({ status: "submitting" });

    try {
      const res = await fetch("/api/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: p }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `Invite failed (HTTP ${res.status})`;
        setState({ status: "error", message: msg });
        return;
      }

      const agencyName = (data && (data.agencyName || data.agency_name || data.agency)) || undefined;

      setState({ status: "success", agencyName });
      setPassword("");
      setConfirm("");

      setTimeout(() => {
        window.location.href = "/app/chat";
      }, 600);
    } catch (e: any) {
      setState({
        status: "error",
        message: e?.message || "Network error while accepting invite.",
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Join workspace</CardTitle>
              <CardDescription className="mt-1">
                Set a password to finish joining via invite.
              </CardDescription>
            </div>
            <Badge variant="secondary">Louis.Ai</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {state.status === "missing_token" && (
            <>
              <p className="text-sm text-muted-foreground">
                This invite link is missing a token. Please ask your agency owner/admin to resend the invite.
              </p>
              <div className="flex gap-2">
                <Button asChild variant="secondary">
                  <Link href="/login">Go to login</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/request-access">Request access</Link>
                </Button>
              </div>
            </>
          )}

          {(state.status === "ready" || state.status === "submitting" || state.status === "error") && (
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

              {state.status === "error" ? (
                <p className="text-sm text-destructive">{state.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Invites are pre-approved — you’ll go straight into the app after setting a password.
                </p>
              )}

              <Button className="w-full" disabled={state.status === "submitting"}>
                {state.status === "submitting" ? "Joining…" : "Join workspace"}
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

          {state.status === "success" && (
            <>
              <p className="text-sm">
                ✅ Joined{state.agencyName ? ` — welcome to ${state.agencyName}` : ""}.
              </p>
              <p className="text-sm text-muted-foreground">Redirecting you to chat…</p>
              <div className="flex gap-2">
                <Button asChild>
                  <Link href="/app/chat">Go to chat now</Link>
                </Button>
              </div>
            </>
          )}

          {state.status === "idle" && <p className="text-sm text-muted-foreground">Preparing…</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}