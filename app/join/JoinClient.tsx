// app/join/JoinClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = { token: string | null };

type State =
  | { status: "boot" }
  | { status: "missing_token" }
  | { status: "ready" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

function pickTokenFromSearch(sp: ReturnType<typeof useSearchParams>) {
  return (sp.get("token") || sp.get("invite") || sp.get("t") || sp.get("code") || "").trim();
}

export default function JoinClient(props: Props) {
  const sp = useSearchParams();

  const token = useMemo(() => {
    const fromProp = String(props.token ?? "").trim();
    if (fromProp) return fromProp;
    return pickTokenFromSearch(sp);
  }, [props.token, sp]);

  const [state, setState] = useState<State>({ status: "boot" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (!token) setState({ status: "missing_token" });
    else setState({ status: "ready" });
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!token) return setState({ status: "missing_token" });

    const p = password.trim();
    const c = confirm.trim();

    if (!p) return setState({ status: "error", message: "Please enter a password." });
    if (p.length < 8) return setState({ status: "error", message: "Password must be at least 8 characters." });
    if (p !== c) return setState({ status: "error", message: "Passwords do not match." });

    setState({ status: "submitting" });

    try {
      const r = await fetch("/api/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password: p }),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        const msg = String(j?.error || j?.message || `Invite failed (HTTP ${r.status})`);
        setState({ status: "error", message: msg });
        return;
      }

      setState({ status: "success" });
      setPassword("");
      setConfirm("");

      const redirectTo = String(j?.redirectTo || "/app/chat");
      window.location.href = redirectTo;
    } catch (e: any) {
      setState({ status: "error", message: e?.message || "Network error" });
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Join workspace</CardTitle>
              <CardDescription className="mt-1">Set your password to finish joining.</CardDescription>
            </div>
            <Badge variant="secondary">Louis.Ai</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {state.status === "missing_token" ? (
            <>
              <p className="text-sm text-muted-foreground">
                This invite link is missing a token. Ask the owner/admin to resend the invite.
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
          ) : null}

          {state.status !== "missing_token" ? (
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

              {state.status === "error" ? <p className="text-sm text-destructive">{state.message}</p> : null}

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
          ) : null}

          {state.status === "success" ? (
            <p className="text-sm text-muted-foreground">Redirecting…</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}