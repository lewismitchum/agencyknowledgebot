// app/request-access/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function RequestAccessPage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");

    const fd = new FormData(e.currentTarget);
    const agency = String(fd.get("agency") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "").trim();

    if (!agency || !email || !password) {
      setErr("Missing fields.");
      return;
    }

    setBusy(true);
    try {
      const r = await fetch("/api/auth/request-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // allow user to enter either agency name or agency email into the same field
          agency_email: agency.includes("@") ? agency : "",
          agency_name: agency.includes("@") ? "" : agency,
          email,
          password,
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        const code = String(j?.error || "");
        if (code === "AGENCY_NOT_FOUND") setErr("Agency not found. Ask your owner/admin for the correct workspace name/email.");
        else if (code === "EMAIL_ALREADY_IN_USE") setErr("That email is already used in another workspace.");
        else if (code === "USER_ALREADY_EXISTS") setErr("You already requested access (or already belong to this workspace).");
        else if (code === "PASSWORD_TOO_SHORT") setErr("Password must be at least 8 characters.");
        else if (code === "INVALID_EMAIL") setErr("Enter a valid email.");
        else setErr(code || "Request failed.");
        return;
      }

      setOk("Request sent. An owner/admin must approve you before you can log in.");
      window.location.href = "/pending-approval";
    } catch (e: any) {
      setErr(e?.message || "Network error.");
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
              <CardTitle>Request access</CardTitle>
              <CardDescription className="mt-1">
                Ask to join an existing workspace. You’ll be pending until approved by an owner/admin.
              </CardDescription>
            </div>
            <Badge variant="secondary">Louis.Ai</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {err ? (
            <div className="rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Request failed</div>
              <div className="mt-1 text-muted-foreground">{err}</div>
            </div>
          ) : null}

          {ok ? (
            <div className="rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">Submitted</div>
              <div className="mt-1 text-muted-foreground">{ok}</div>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Workspace name or owner email</label>
              <input
                name="agency"
                className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                placeholder="Acme Agency (or owner@acme.com)"
                autoComplete="organization"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Your email</label>
              <input
                name="email"
                type="email"
                className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Password</label>
              <input
                name="password"
                type="password"
                className="mt-1 w-full rounded-xl border px-3 py-2 bg-background"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>

            <Button className="w-full" disabled={busy}>
              {busy ? "Submitting…" : "Request access"}
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

          <p className="text-xs text-muted-foreground">
            If you were invited, use the invite link instead — it gives immediate access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}