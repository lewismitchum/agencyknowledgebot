"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function PublicHeader() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { credentials: "include" });
        setAuthed(r.ok);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  const primaryHref = authed ? "/app" : "/signup";
  const primaryLabel = authed ? "Open app" : "Start free";

  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl border bg-card" />
          <div className="leading-tight">
            <div className="text-sm font-semibold">Louis.Ai</div>
            <div className="text-xs text-muted-foreground">Let’s Alter Minds</div>
          </div>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            href="/pricing"
            className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Pricing
          </Link>

          {authed ? (
            <Link
              href="/app"
              className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Login
            </Link>
          )}

          <Link
            href={primaryHref}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {authed === null ? "Loading…" : primaryLabel}
          </Link>
        </nav>
      </div>
    </header>
  );
}
