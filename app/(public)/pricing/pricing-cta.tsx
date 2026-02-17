"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function PricingCTA() {
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
    <div className="mt-6 flex flex-wrap gap-3">
      <Link
        href={primaryHref}
        className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {authed === null ? "Loading…" : primaryLabel}
      </Link>

      <Link
        href="/"
        className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
      >
        Back to home
      </Link>
    </div>
  );
}
