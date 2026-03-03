// app/join/JoinClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Props = {
  token: string | null;
};

type AcceptResp =
  | {
      ok: true;
      redirectTo?: string;
      alreadyAccepted?: boolean;
      agency_id?: string;
      email?: string;
      status?: string;
    }
  | {
      ok: false;
      error: string;
      message?: string;
    };

export default function JoinClient({ token }: Props) {
  const [state, setState] = useState<
    "idle" | "redeeming" | "success" | "error"
  >(token ? "redeeming" : "idle");
  const [error, setError] = useState<string | null>(null);

  const safeToken = useMemo(() => (token ? String(token).trim() : ""), [token]);

  useEffect(() => {
    if (!safeToken) return;

    let cancelled = false;

    async function run() {
      try {
        setState("redeeming");
        setError(null);

        const res = await fetch("/api/agency/invites/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: safeToken }),
        });

        const data = (await res.json().catch(() => null)) as AcceptResp | null;

        if (cancelled) return;

        if (!res.ok || !data || (data as any).ok !== true) {
          const msg =
            (data && "error" in data && data.error) ||
            `HTTP_${res.status}`;
          setError(msg);
          setState("error");
          return;
        }

        setState("success");

        const redirectTo =
          ("redirectTo" in data && data.redirectTo) || "/login";

        // small delay so user sees success state if needed
        window.location.href = redirectTo;
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message ?? e));
        setState("error");
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [safeToken]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Join Agency</h1>

        {!safeToken ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              This invite link is missing a token. Ask your owner/admin for a
              fresh invite link.
            </p>

            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Missing token.
            </div>
          </>
        ) : state === "redeeming" ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Redeeming your invite…
            </p>
            <div className="mt-6 rounded-xl border bg-muted/30 p-4 text-sm">
              Working…
            </div>
          </>
        ) : state === "error" ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              We couldn’t redeem that invite.
            </p>
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error ?? "UNKNOWN_ERROR"}
            </div>

            <div className="mt-6 flex flex-col gap-2 text-sm">
              <Link href="/login" className="underline hover:text-foreground">
                Try logging in
              </Link>
              <Link href="/signup" className="underline hover:text-foreground">
                Or create an account
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Invite accepted. Redirecting…
            </p>
            <div className="mt-6 rounded-xl border bg-muted/30 p-4 text-sm">
              Redirecting…
            </div>
          </>
        )}
      </div>

      <div className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="underline hover:text-foreground">
          Go to login
        </Link>
        {" · "}
        <Link href="/signup" className="underline hover:text-foreground">
          Create account
        </Link>
      </div>
    </main>
  );
}