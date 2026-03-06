"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";
import { hasFeature } from "@/lib/plans";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";

type GateState = "checking" | "ok" | "redirecting";

type MeResponse = {
  ok: boolean;
  user?: {
    id: string;
    email: string;
    email_verified: number;
    role: string;
    status: string;
    has_completed_onboarding?: number;
  };
  agency?: {
    id: string;
    name: string | null;
    plan?: string | null;
  };
};

function isFetchJsonError(e: any): e is FetchJsonError {
  return !!e && typeof e === "object" && (e?.name === "FetchJsonError" || "info" in e);
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [gate, setGate] = useState<GateState>("checking");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  const plan = String(me?.agency?.plan ?? "free");

  const canSeeEmail = hasFeature(plan, "email");
  const canSeeSheets = hasFeature(plan, "spreadsheets");

  const mobileScrollRef = useRef<HTMLDivElement | null>(null);

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
        const j = await fetchJson<MeResponse>("/api/me", {
          credentials: "include",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });

        if (cancelled) return;

        setMe(j);
        const completed = Number(j?.user?.has_completed_onboarding ?? 0) === 1;
        setShowOnboarding(!completed);
        setGate("ok");
      } catch (e: any) {
        if (cancelled) return;

        if (isFetchJsonError(e)) {
          const status = Number(e?.info?.status ?? 0);

          if (status === 401) {
            setGate("redirecting");
            window.location.href = "/login";
            return;
          }

          if (status === 403) {
            setGate("redirecting");
            window.location.href = "/check-email";
            return;
          }
        }

        setGate("ok");
      }
    }

    setGate("checking");
    run();

    return () => {
      cancelled = true;
    };
  }, [gateBypass]);

  async function completeOnboarding(mode: "upload" | "skip") {
    if (onboardingBusy) return;
    setOnboardingBusy(true);

    try {
      await fetchJson("/api/onboarding/complete", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      }).catch(() => {});

      setShowOnboarding(false);

      if (mode === "upload") {
        window.location.href = "/app/docs";
      }
    } finally {
      setOnboardingBusy(false);
    }
  }

  useEffect(() => {
    const el = mobileScrollRef.current;
    if (!el) return;

    const activeEl = el.querySelector('[data-active="true"]') as HTMLElement | null;
    if (!activeEl) return;

    const left = activeEl.offsetLeft - el.clientWidth / 2 + activeEl.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [pathname]);

  if (gate !== "ok") {
    return (
      <div className="min-h-screen bg-background">
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
      {showOnboarding ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur">
          <div className="w-full max-w-xl rounded-3xl border bg-card p-6 shadow-xl">
            <div className="text-xl font-semibold tracking-tight">Welcome to Louis.Ai</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Your workspace is ready. Start by giving Louis one important internal document.
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => completeOnboarding("skip")}
                disabled={onboardingBusy}
                className="rounded-full border border-white/10 bg-background/60 px-4 py-2 text-sm shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
              >
                Skip for now
              </button>

              <button
                onClick={() => completeOnboarding("upload")}
                disabled={onboardingBusy}
                className="rounded-full border border-white/10 bg-foreground px-4 py-2 text-sm font-medium text-background shadow-sm transition hover:-translate-y-0.5 hover:opacity-90"
              >
                Upload first document
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-7xl">
        <aside className="hidden min-h-screen w-72 border-r border-white/10 bg-background/40 p-6 backdrop-blur md:block">
          <Link href="/app" className="block text-lg font-semibold tracking-tight">
            Louis.Ai
          </Link>

          <p className="mt-1 text-sm text-muted-foreground">Let’s Alter Minds</p>

          <nav className="mt-8 space-y-1 text-sm">
            <NavItem href="/app" active={pathname === "/app"}>Dashboard</NavItem>
            <NavItem href="/app/chat" active={pathname === "/app/chat"}>Chat</NavItem>
            <NavItem href="/app/docs" active={pathname?.startsWith("/app/docs")}>Docs</NavItem>
            <NavItem href="/app/bots" active={pathname === "/app/bots"}>Bots</NavItem>
            <NavItem href="/app/schedule" active={pathname?.startsWith("/app/schedule")}>Schedule</NavItem>
            <NavItem href="/app/notifications" active={pathname?.startsWith("/app/notifications")}>Notifications</NavItem>
            <NavItem href="/app/extractions" active={pathname?.startsWith("/app/extractions")}>Extractions</NavItem>

            {canSeeSheets && (
              <NavItem href="/app/spreadsheets" active={pathname?.startsWith("/app/spreadsheets")}>
                Spreadsheets
              </NavItem>
            )}

            {canSeeEmail && (
              <NavItem href="/app/email" active={pathname?.startsWith("/app/email")}>
                Email
              </NavItem>
            )}

            <NavItem href="/app/billing" active={pathname === "/app/billing"}>Billing</NavItem>
            <NavItem href="/app/settings" active={pathname === "/app/settings"}>Settings</NavItem>
            <NavItem href="/app/support" active={pathname?.startsWith("/app/support")}>Support</NavItem>
          </nav>
        </aside>

        <div className="flex-1">
          <header className="sticky top-0 z-10 border-b border-white/10 bg-background/70 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-4 md:px-8">
              <div className="text-sm text-muted-foreground">Private workspace</div>

              <div className="flex items-center gap-2">
                <Link
                  href="/app/support"
                  className="rounded-full border border-white/10 bg-background/60 px-4 py-2 text-sm shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
                >
                  Support
                </Link>

                <ModeToggle />

                <Link
                  href="/app/billing"
                  className="rounded-full border border-white/10 bg-background/60 px-4 py-2 text-sm shadow-sm transition hover:-translate-y-0.5 hover:bg-accent"
                >
                  Upgrade
                </Link>
              </div>
            </div>
          </header>

          <main className="px-4 py-8 pb-28 md:px-8 md:pb-8">{children}</main>
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
        "block rounded-xl px-3 py-2 transition-all duration-200",
        active
          ? "bg-accent text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-accent hover:text-foreground hover:translate-x-1",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}