// app/(app)/app/layout.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";

type GateState = "checking" | "ok" | "redirecting";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [gate, setGate] = useState<GateState>("checking");

  // allow these inside /app without forcing a redirect loop
  const gateBypass = useMemo(() => {
    if (!pathname) return false;
    return (
      pathname.startsWith("/app/check-email") ||
      pathname.startsWith("/app/verify-email") ||
      pathname.startsWith("/app/logout")
    );
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (gateBypass) {
        if (!cancelled) setGate("ok");
        return;
      }

      try {
        const r = await fetch("/api/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });

        if (cancelled) return;

        if (r.status === 401) {
          setGate("redirecting");
          window.location.href = "/login";
          return;
        }

        if (r.status === 403) {
          setGate("redirecting");
          window.location.href = "/check-email";
          return;
        }

        // if /api/me returns other errors, do not brick the app shell
        setGate("ok");
      } catch {
        if (!cancelled) setGate("ok");
      }
    }

    setGate("checking");
    run();

    return () => {
      cancelled = true;
    };
  }, [gateBypass]);

  // Minimal gate UI — prevents random 403 flashes on first paint
  if (gate !== "ok") {
    return (
      <div className="min-h-screen bg-background">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.05),transparent_50%)]" />
        </div>

        <div className="mx-auto flex max-w-7xl px-4 py-10">
          <div className="w-full rounded-3xl border bg-card p-6 shadow-sm">
            <div className="text-sm font-medium">Loading workspace…</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {gate === "redirecting" ? "Redirecting…" : "Checking your access…"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.05),transparent_50%)]" />
      </div>

      <div className="mx-auto flex max-w-7xl">
        <aside className="hidden min-h-screen w-72 border-r border-white/10 bg-background/40 p-6 backdrop-blur md:block">
          <Link href="/app" className="block text-lg font-semibold tracking-tight">
            Louis.Ai
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">Let’s Alter Minds</p>

          <nav className="mt-8 space-y-1 text-sm">
            <NavItem href="/app" active={pathname === "/app"}>
              Dashboard
            </NavItem>
            <NavItem href="/app/chat" active={pathname === "/app/chat"}>
              Chat
            </NavItem>
            <NavItem href="/app/docs" active={pathname?.startsWith("/app/docs")}>
              Docs
            </NavItem>
            <NavItem href="/app/bots" active={pathname === "/app/bots"}>
              Bots
            </NavItem>
            <NavItem href="/app/schedule" active={pathname?.startsWith("/app/schedule")}>
              Schedule
            </NavItem>
            <NavItem href="/app/notifications" active={pathname?.startsWith("/app/notifications")}>
              Notifications
            </NavItem>
            <NavItem href="/app/extractions" active={pathname?.startsWith("/app/extractions")}>
              Extractions
            </NavItem>
            <NavItem href="/app/billing" active={pathname === "/app/billing"}>
              Billing
            </NavItem>
            <NavItem href="/app/settings" active={pathname === "/app/settings"}>
              Settings
            </NavItem>
            <NavItem href="/app/support" active={pathname?.startsWith("/app/support")}>
              Support
            </NavItem>
          </nav>

          <div className="mt-10 rounded-2xl border border-white/10 bg-background/50 p-4">
            <p className="text-sm font-medium">Docs-first reliability</p>
            <p className="mt-1 text-xs text-muted-foreground">
              For internal questions, if the docs don’t support an answer:
            </p>
            <div className="mt-2 rounded-xl bg-muted/60 p-3 font-mono text-[12px]">
              I don’t have that information in the docs yet.
            </div>
          </div>
        </aside>

        <div className="flex-1">
          <header className="sticky top-0 z-10 border-b border-white/10 bg-background/60 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-4 md:px-8">
              <div className="text-sm text-muted-foreground">Private workspace</div>

              <div className="flex items-center gap-2">
                <Link
                  href="/app/support"
                  className="rounded-full border border-white/10 bg-background/60 px-4 py-2 text-sm shadow-sm hover:bg-accent"
                >
                  Support
                </Link>
                <ModeToggle />
                <Link
                  href="/app/billing"
                  className="rounded-full border border-white/10 bg-background/60 px-4 py-2 text-sm shadow-sm hover:bg-accent"
                >
                  Upgrade
                </Link>
              </div>
            </div>
          </header>

          <main className="px-4 py-8 pb-24 md:px-8 md:pb-8">{children}</main>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-background/70 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-around px-3 py-3 text-sm">
          <MobileItem href="/app" label="Home" active={pathname === "/app"} />
          <MobileItem href="/app/chat" label="Chat" active={pathname === "/app/chat"} />
          <MobileItem href="/app/docs" label="Docs" active={pathname?.startsWith("/app/docs")} />
          <MobileItem href="/app/bots" label="Bots" active={pathname === "/app/bots"} />
          <MobileItem href="/app/schedule" label="Schedule" active={pathname?.startsWith("/app/schedule")} />
          <MobileItem href="/app/notifications" label="Notify" active={pathname?.startsWith("/app/notifications")} />
          <MobileItem href="/app/support" label="Help" active={pathname?.startsWith("/app/support")} />
          <MobileItem href="/app/settings" label="Settings" active={pathname === "/app/settings"} />
        </div>
      </div>
    </div>
  );
}

function NavItem({ href, children, active }: { href: string; children: React.ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      className={[
        "block rounded-xl px-3 py-2 transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

function MobileItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={[
        "rounded-xl px-3 py-2 transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}