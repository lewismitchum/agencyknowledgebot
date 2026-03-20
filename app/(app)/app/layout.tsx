"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import OnboardingTour from "@/components/onboarding-tour";
import { hasFeature } from "@/lib/plans";
import { fetchJson, type FetchJsonError } from "@/lib/fetch-json";
import SiteFooter from "@/components/site-footer";
import Navbar from "./_components/navbar";

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

  const plan = String(me?.agency?.plan ?? "free");

  const canSeeEmail = hasFeature(plan, "email");
  const canSeeSheets = hasFeature(plan, "spreadsheets");

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
      <OnboardingTour canSeeEmail={canSeeEmail} canSeeSheets={canSeeSheets} />
      <Navbar />

      <div className="flex min-h-screen flex-col">
        <main className="min-w-0 flex-1 px-4 py-6 pb-28 md:px-8 md:py-8 md:pb-8">
          {children}
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}