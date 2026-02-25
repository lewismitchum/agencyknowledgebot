"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message?: string }
  | { status: "error"; message: string };

export default function RequestAccessPage() {
  const [state, setState] = useState<State>({ status: "idle" });

  const [agencyEmail, setAgencyEmail] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function isEmail(s: string) {
    const v = String(s ?? "").trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const ae = agencyEmail.trim().toLowerCase();
    const an = agencyName.trim();
    const em = email.trim().toLowerCase();
    const pw = password.trim();

    if (!ae && !an) {
      setState({ status: "error", message: "Enter the agency email or agency name." });
      return;
    }
    if (!isEmail(em)) {
      setState({ status: "error", message: "Enter a valid email." });
      return;
    }
    if (!pw || pw.length < 8) {
      setState({ status: "error", message: "Password must be at least 8 characters." });
      return;
    }

    setState({ status: "submitting" });

    try {
      const res = await fetch("/api/auth/request-join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agency_email: ae || undefined,
          agency_name: an || undefined,
          email: em,
          password: pw,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          (data && (data.error || data.message)) || `Request failed (HTTP ${res.status})`;
        setState({ status: "error", message: msg });
        return;
      }

      setState({
        status: "success",
        message:
          (data && (data.message || data.msg)) ||
          "Request submitted. An owner/admin must approve you.",
      });

      setTimeout(() => {
        window.location.href = "/pending-approval";
      }, 600);
    } catch (err: any) {
      setState({
        status: "error",
        message: err?.message || "Network error while submitting request.",
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Request access</CardTitle>
              <CardDescription className="mt-1">
                Ask to join an existing agency workspace. An owner/admin must approve you.
              </CardDescription>
            </div>
            <Badge variant="secondary">Louis.Ai</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {state.status === "success" ? (
            <>
              <p className="text-sm">✅ Request submitted.</p>
              <p className="text-sm text-muted-foreground">
                Redirecting you to the pending approval page…
              </p>
              <div className="flex gap-2">
                <Button asChild>
                  <Link href="/pending-approval">Continue</Link>
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Agency email (recommended)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={agencyEmail}
                  onChange={(e) => setAgencyEmail(e.target.value)}
                  placeholder="owner@agency.com"
                  type="email"
                  autoComplete="off"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Agency name (optional)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  placeholder="Acme Creative"
                  type="text"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Use either agency email or agency name.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium">Your email</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  type="email"
                  autoComplete="email"
                />
              </div>

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

              {state.status === "error" ? (
                <p className="text-sm text-destructive">{state.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  After you submit, you’ll be pending until approved by an owner/admin.
                </p>
              )}

              <Button className="w-full" disabled={state.status === "submitting"}>
                {state.status === "submitting" ? "Submitting…" : "Request access"}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <Link className="text-muted-foreground underline" href="/login">
                  Back to login
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