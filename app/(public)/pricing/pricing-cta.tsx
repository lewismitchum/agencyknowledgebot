// app/(public)/pricing/pricing-cta.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function PricingCta() {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch("/api/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });

        if (cancelled) return;

        // /api/me returns 401 when not logged in; treat any non-401 as "authed enough"
        setAuthed(r.ok);
      } catch {
        if (!cancelled) setAuthed(false);
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Avoid button flash while checking session
  if (!checked) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="h-10 w-40 rounded-xl border bg-muted/40" />
        <div className="h-10 w-40 rounded-xl border bg-muted/30" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {authed ? (
        <Link
          href="/app/billing"
          className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Upgrade
        </Link>
      ) : (
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Create account
        </Link>
      )}

      <Link
        href={authed ? "/app" : "/login"}
        className="inline-flex items-center justify-center rounded-xl border px-4 py-2.5 text-sm hover:bg-accent"
      >
        {authed ? "Go to app" : "Log in"}
      </Link>
    </div>
  );
}