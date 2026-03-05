// app/join/JoinClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  token: string | null;
};

type State =
  | { status: "boot" }
  | { status: "missing_token" }
  | { status: "checking" }
  | { status: "error"; message: string }
  | { status: "ok"; redirectTo: string };

function pickTokenFromSearch(sp: ReturnType<typeof useSearchParams>) {
  return (sp.get("token") || sp.get("invite") || sp.get("t") || sp.get("code") || "").trim();
}

function pickTokenFromPathname(pathname: string) {
  // supports:
  // /join/<token>
  // /join/<token>/anything
  const p = String(pathname || "").trim();
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  const joinIdx = parts.indexOf("join");
  if (joinIdx === -1) return "";
  const maybe = parts[joinIdx + 1] || "";
  return String(maybe).trim();
}

export default function JoinClient(props: Props) {
  const sp = useSearchParams();

  const fromProp = useMemo(() => String(props.token ?? "").trim(), [props.token]);
  const fromQuery = useMemo(() => pickTokenFromSearch(sp), [sp]);

  // resolved token (prop > query > pathname)
  const [resolvedToken, setResolvedToken] = useState<string>("");

  const [state, setState] = useState<State>({ status: "boot" });

  useEffect(() => {
    // Resolve token on client, including pathname fallback.
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const fromPath = pickTokenFromPathname(path);

    const t = (fromProp || fromQuery || fromPath || "").trim();
    setResolvedToken(t);

    if (!t) setState({ status: "missing_token" });
    else setState({ status: "checking" });
  }, [fromProp, fromQuery]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const token = String(resolvedToken || "").trim();
      if (!token) return;

      setState({ status: "checking" });

      try {
        const r = await fetchJson(`/api/agency/invites/accept?token=${encodeURIComponent(token)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const j = await r.json().catch(() => null);

        if (!r.ok) {
          const msg = String(j?.error || j?.message || `Invite failed (HTTP ${r.status})`);
          if (!cancelled) setState({ status: "error", message: msg });
          return;
        }

        const redirectTo = String(j?.redirectTo || j?.redirect_to || "").trim();
        if (!redirectTo) {
          if (!cancelled) setState({ status: "error", message: "Invite accepted but missing redirectTo." });
          return;
        }

        if (!cancelled) setState({ status: "ok", redirectTo });

        window.location.href = redirectTo;
      } catch (e: any) {
        if (!cancelled) setState({ status: "error", message: e?.message || "Network error" });
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [resolvedToken]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Joining workspace</CardTitle>
              <CardDescription className="mt-1">Finalizing your invite…</CardDescription>
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

          {state.status === "checking" || state.status === "boot" ? (
            <p className="text-sm text-muted-foreground">Checking invite…</p>
          ) : null}

          {state.status === "ok" ? <p className="text-sm text-muted-foreground">Redirecting…</p> : null}

          {state.status === "error" ? (
            <>
              <p className="text-sm text-destructive">{state.message}</p>
              <div className="flex gap-2">
                <Button asChild variant="secondary">
                  <Link href="/login">Go to login</Link>
                </Button>
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Retry
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}