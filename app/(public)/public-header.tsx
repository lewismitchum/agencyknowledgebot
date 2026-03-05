// app/(public)/public-header.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function PublicHeader() {
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

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Louis.Ai
          </Link>
          <span className="hidden text-xs text-muted-foreground sm:inline">Let’s Alter Minds</span>
        </div>

        <nav className="flex items-center gap-2">
          <Link href="/pricing" className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            Pricing
          </Link>

          {checked ? (
            authed ? (
              <>
                <Link
                  href="/app"
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-accent"
                >
                  Go to app
                </Link>
                <Link
                  href="/app/billing"
                  className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Upgrade
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-xl border px-3 py-2 text-sm hover:bg-accent"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Create account
                </Link>
              </>
            )
          ) : (
            <div className="h-9 w-36 rounded-xl border bg-muted/30" />
          )}
        </nav>
      </div>
    </header>
  );
}