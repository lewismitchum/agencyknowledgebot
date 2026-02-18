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
  | { status: "loading" }
  | { status: "success"; agencyName?: string }
  | { status: "error"; message: string };

function AcceptInviteInner() {
  const sp = useSearchParams();

  const token = useMemo(() => {
    // Support a couple common param names
    return sp.get("token") || sp.get("invite") || sp.get("code") || "";
  }, [sp]);

  const [state, setState] = useState<AcceptState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setState({ status: "missing_token" });
        return;
      }

      setState({ status: "loading" });

      try {
        const res = await fetch("/api/accept-invite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg =
            (data && (data.error || data.message)) ||
            `Invite failed (HTTP ${res.status})`;
          if (!cancelled) setState({ status: "error", message: msg });
          return;
        }

        // Optional fields if your API returns them
        const agencyName =
          (data && (data.agencyName || data.agency_name || data.agency)) || undefined;

        if (!cancelled) setState({ status: "success", agencyName });

        // Move user into the app after accepting.
        // Keep it simple and robust across route groups.
        setTimeout(() => {
          window.location.href = "/chat";
        }, 600);
      } catch (e: any) {
        if (!cancelled) {
          setState({
            status: "error",
            message: e?.message || "Network error while accepting invite.",
          });
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Accept invite</CardTitle>
              <CardDescription className="mt-1">
                Joining an agency will give you access to its shared bot(s) and docs.
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
                  <Link href="/signup">Create account</Link>
                </Button>
              </div>
            </>
          )}

          {state.status === "loading" && (
            <p className="text-sm text-muted-foreground">
              Accepting invite… hang tight.
            </p>
          )}

          {state.status === "success" && (
            <>
              <p className="text-sm">
                ✅ Invite accepted{state.agencyName ? ` — welcome to ${state.agencyName}` : ""}.
              </p>
              <p className="text-sm text-muted-foreground">
                Redirecting you to chat…
              </p>
              <div className="flex gap-2">
                <Button asChild>
                  <Link href="/chat">Go to chat now</Link>
                </Button>
              </div>
            </>
          )}

          {state.status === "error" && (
            <>
              <p className="text-sm">
                ❌ Could not accept invite.
              </p>
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <div className="flex gap-2">
                <Button asChild variant="secondary">
                  <Link href="/login">Try logging in</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/signup">Or create account</Link>
                </Button>
              </div>
            </>
          )}

          {state.status === "idle" && (
            <p className="text-sm text-muted-foreground">
              Preparing…
            </p>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        If your build ever fails mentioning <code>useSearchParams()</code>, it means it’s being used outside a Suspense boundary.
        This page keeps it inside a Suspense-wrapped child component.
      </p>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}
