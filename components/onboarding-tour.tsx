"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles, X } from "lucide-react";
import { ONBOARDING_STEPS } from "@/lib/onboarding-steps";

const STORAGE_STARTED = "louisai_onboarding_started";
const STORAGE_COMPLETED = "louisai_onboarding_completed";
const STORAGE_DISMISSED = "louisai_onboarding_dismissed";
const STORAGE_INDEX = "louisai_onboarding_index";

type OnboardingTourProps = {
  canSeeEmail?: boolean;
  canSeeSheets?: boolean;
};

type OnboardingApiResponse = {
  ok?: boolean;
  onboarding?: {
    completed_steps?: number;
    total_steps?: number;
    percent?: number;
  };
};

type TourTargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TourStep = {
  path: string;
  title: string;
  description: string;
  tasks: string[];
  cta?: string;
  feature?: string;
  selector?: string;
  selectorMobile?: string;
  placement?: "top" | "bottom" | "left" | "right" | "center";
  spotlightPadding?: number;
  requireTarget?: boolean;
};

function readNumber(value: string | null, fallback = 0) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getIsMobile() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

function getStepSelector(step: TourStep) {
  const mobile = getIsMobile();
  return mobile ? step.selectorMobile || step.selector || "" : step.selector || step.selectorMobile || "";
}

function findTarget(step: TourStep): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const selector = getStepSelector(step);
  if (!selector) return null;
  try {
    return document.querySelector(selector) as HTMLElement | null;
  } catch {
    return null;
  }
}

function getRect(el: HTMLElement, padding: number): TourTargetRect {
  const r = el.getBoundingClientRect();
  return {
    top: Math.max(0, r.top - padding),
    left: Math.max(0, r.left - padding),
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  };
}

function isVisibleInViewport(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0;
}

export default function OnboardingTour({
  canSeeEmail = false,
  canSeeSheets = false,
}: OnboardingTourProps) {
  const pathname = usePathname();
  const router = useRouter();

  const steps = useMemo(() => {
    return (ONBOARDING_STEPS as TourStep[]).filter((step) => {
      if (step.feature === "email") return canSeeEmail;
      if (step.feature === "spreadsheets") return canSeeSheets;
      return true;
    });
  }, [canSeeEmail, canSeeSheets]);

  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [tourEligible, setTourEligible] = useState(true);
  const [allowManualStart, setAllowManualStart] = useState(false);
  const [targetRect, setTargetRect] = useState<TourTargetRect | null>(null);
  const [targetReady, setTargetReady] = useState(false);

  const pollRef = useRef<number | null>(null);

  const total = steps.length;
  const step = steps[index] ?? null;

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (typeof window === "undefined") return;

      const completedLocal = localStorage.getItem(STORAGE_COMPLETED) === "1";
      const dismissed = localStorage.getItem(STORAGE_DISMISSED) === "1";
      const hasStarted = localStorage.getItem(STORAGE_STARTED) === "1";
      const savedIndex = readNumber(localStorage.getItem(STORAGE_INDEX), 0);
      const safeIndex = Math.max(0, Math.min(savedIndex, Math.max(steps.length - 1, 0)));
      const isAppRoute = pathname?.startsWith("/app");

      setStarted(hasStarted);
      setIndex(safeIndex);

      let shouldAutoOpen = false;
      let shouldAllowManualStart = false;
      let isEligible = true;

      try {
        const r = await fetch("/api/onboarding", {
          credentials: "include",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });

        const j = (await r.json().catch(() => null)) as OnboardingApiResponse | null;
        const completedSteps = Number(j?.onboarding?.completed_steps ?? 0);
        const totalSteps = Number(j?.onboarding?.total_steps ?? 0);
        const onboardingComplete = totalSteps > 0 && completedSteps >= totalSteps;

        isEligible = !onboardingComplete;
        shouldAllowManualStart = isEligible || hasStarted || dismissed;

        if (!completedLocal && isAppRoute && !dismissed && isEligible) {
          shouldAutoOpen = true;
        }
      } catch {
        isEligible = true;
        shouldAllowManualStart = true;

        if (!completedLocal && isAppRoute && !dismissed) {
          shouldAutoOpen = true;
        }
      }

      if (cancelled) return;

      setTourEligible(isEligible);
      setAllowManualStart(shouldAllowManualStart);

      if (completedLocal) {
        setOpen(false);
        setStarted(false);
        setReady(true);
        return;
      }

      if (shouldAutoOpen) {
        window.setTimeout(() => {
          if (!cancelled) setOpen(true);
        }, 350);
      } else {
        setOpen(false);
      }

      setReady(true);
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [pathname, steps.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const safeIndex = Math.max(0, Math.min(index, Math.max(steps.length - 1, 0)));
    if (safeIndex !== index) {
      setIndex(safeIndex);
      return;
    }
    localStorage.setItem(STORAGE_INDEX, String(safeIndex));
  }, [index, steps.length]);

  const isOnCurrentStepPage = useMemo(() => {
    if (!step || !pathname) return false;
    return pathname === step.path || pathname.startsWith(`${step.path}/`);
  }, [pathname, step]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setTargetRect(null);
    setTargetReady(false);

    if (!open || !step || !isOnCurrentStepPage) return;

    function syncTarget() {
      const el = findTarget(step);

      if (!el || !isVisibleInViewport(el)) {
        setTargetRect(null);
        setTargetReady(false);
        return;
      }

      const padding = Number(step.spotlightPadding ?? 10);
      const rect = getRect(el, padding);
      setTargetRect(rect);
      setTargetReady(true);
    }

    const immediate = window.setTimeout(() => {
      const el = findTarget(step);
      if (el) {
        try {
          el.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "smooth",
          });
        } catch {
          // ignore
        }
      }
      window.setTimeout(syncTarget, 220);
    }, 120);

    pollRef.current = window.setInterval(syncTarget, 300);

    const onResize = () => syncTarget();
    const onScroll = () => syncTarget();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.clearTimeout(immediate);
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, step, isOnCurrentStepPage]);

  function startTour() {
    if (!steps.length) return;

    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_STARTED, "1");
      localStorage.removeItem(STORAGE_DISMISSED);
      localStorage.removeItem(STORAGE_COMPLETED);
      localStorage.setItem(STORAGE_INDEX, "0");
    }

    setStarted(true);
    setIndex(0);
    setOpen(true);
    setTourEligible(true);
    router.push(steps[0].path);
  }

  function skipTour() {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_DISMISSED, "1");
    }
    setOpen(false);
  }

  function closeTour() {
    setOpen(false);
  }

  function completeTour() {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_COMPLETED, "1");
      localStorage.removeItem(STORAGE_STARTED);
      localStorage.removeItem(STORAGE_INDEX);
      localStorage.removeItem(STORAGE_DISMISSED);
    }
    setOpen(false);
    setStarted(false);
    setTourEligible(false);
    router.push("/app");
  }

  function goToStep(nextIndex: number) {
    if (!steps.length) return;
    const safeIndex = Math.max(0, Math.min(nextIndex, steps.length - 1));
    setIndex(safeIndex);
    router.push(steps[safeIndex].path);
  }

  function nextStep() {
    if (!step) return;

    if (!isOnCurrentStepPage) {
      router.push(step.path);
      return;
    }

    if (step.requireTarget && !targetReady) {
      return;
    }

    if (index >= total - 1) {
      completeTour();
      return;
    }

    goToStep(index + 1);
  }

  function prevStep() {
    if (index <= 0) return;
    goToStep(index - 1);
  }

  function renderSpotlightCutout() {
    if (!targetRect) return null;

    const radius = 16;
    return (
      <>
        <div
          className="absolute bg-black/60 backdrop-blur-sm"
          style={{
            top: 0,
            left: 0,
            width: "100%",
            height: targetRect.top,
          }}
        />
        <div
          className="absolute bg-black/60 backdrop-blur-sm"
          style={{
            top: targetRect.top,
            left: 0,
            width: targetRect.left,
            height: targetRect.height,
          }}
        />
        <div
          className="absolute bg-black/60 backdrop-blur-sm"
          style={{
            top: targetRect.top,
            left: targetRect.left + targetRect.width,
            right: 0,
            height: targetRect.height,
          }}
        />
        <div
          className="absolute bg-black/60 backdrop-blur-sm"
          style={{
            top: targetRect.top + targetRect.height,
            left: 0,
            width: "100%",
            bottom: 0,
          }}
        />
        <div
          className="pointer-events-none absolute border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0)]"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            borderRadius: radius,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.02)",
          }}
        />
      </>
    );
  }

  function getCardStyle() {
    if (!targetRect || !step || step.placement === "center" || !isOnCurrentStepPage) {
      return {
        top: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(760px, calc(100% - 24px))",
      } as const;
    }

    const vw = typeof window !== "undefined" ? window.innerWidth : 1400;
    const vh = typeof window !== "undefined" ? window.innerHeight : 900;
    const cardWidth = Math.min(420, vw - 24);
    const gap = 16;
    const placement = step.placement || "bottom";

    if (placement === "bottom") {
      return {
        top: clamp(targetRect.top + targetRect.height + gap, 12, vh - 320),
        left: clamp(targetRect.left, 12, vw - cardWidth - 12),
        width: cardWidth,
      } as const;
    }

    if (placement === "top") {
      return {
        top: clamp(targetRect.top - 320 - gap, 12, vh - 320),
        left: clamp(targetRect.left, 12, vw - cardWidth - 12),
        width: cardWidth,
      } as const;
    }

    if (placement === "left") {
      return {
        top: clamp(targetRect.top, 12, vh - 320),
        left: clamp(targetRect.left - cardWidth - gap, 12, vw - cardWidth - 12),
        width: cardWidth,
      } as const;
    }

    return {
      top: clamp(targetRect.top, 12, vh - 320),
      left: clamp(targetRect.left + targetRect.width + gap, 12, vw - cardWidth - 12),
      width: cardWidth,
    } as const;
  }

  if (!ready || !steps.length) return null;

  const showStartButton = !started && (tourEligible || allowManualStart);
  const mustFindTarget = !!step?.requireTarget;

  return (
    <>
      {showStartButton && (
        <div className="fixed bottom-5 right-5 z-[70]">
          <button
            type="button"
            onClick={startTour}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-card px-4 py-3 text-sm font-medium text-foreground shadow-2xl transition hover:scale-[1.02] hover:bg-accent"
          >
            <Sparkles className="h-4 w-4" />
            Start guided tour
          </button>
        </div>
      )}

      {open && step && (
        <div className="fixed inset-0 z-[80]">
          {!targetRect ? (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeTour} />
          ) : (
            renderSpotlightCutout()
          )}

          <div className="pointer-events-none absolute inset-0">
            <div
              className="pointer-events-auto absolute"
              style={getCardStyle()}
            >
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-card text-foreground shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
                <div className="border-b border-white/10 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        Guided onboarding
                      </div>
                      <h2 className="text-xl font-semibold tracking-tight">
                        {index + 1}. {step.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {step.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={closeTour}
                      className="rounded-xl border border-white/10 p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      aria-label="Close onboarding"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Step {index + 1} of {total}
                      </span>
                      <span>{Math.round(((index + 1) / total) * 100)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground transition-all"
                        style={{ width: `${((index + 1) / total) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="px-5 py-5">
                  <div className="rounded-2xl border border-white/10 bg-background/40 p-4">
                    <div className="mb-3 text-sm font-medium text-foreground">
                      What this part does
                    </div>

                    <div className="space-y-3">
                      {step.tasks.map((task, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <p className="text-sm leading-6 text-muted-foreground">{task}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-background/40 p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Current destination
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{step.path}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {!isOnCurrentStepPage
                            ? "Go to this page to continue."
                            : mustFindTarget && !targetReady
                              ? "Waiting for the highlighted control to appear."
                              : targetReady
                                ? "Follow the highlighted control on this page."
                                : "You are on the correct page."}
                        </div>
                      </div>

                      {!isOnCurrentStepPage && (
                        <button
                          type="button"
                          onClick={() => router.push(step.path)}
                          className="rounded-2xl border border-white/10 bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                        >
                          {step.cta || "Open page"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={skipTour}
                      className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      Skip for now
                    </button>

                    <button
                      type="button"
                      onClick={prevStep}
                      disabled={index === 0}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={nextStep}
                    disabled={mustFindTarget && isOnCurrentStepPage && !targetReady}
                    className="inline-flex items-center gap-2 rounded-2xl bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {index === total - 1 && isOnCurrentStepPage
                      ? "Finish"
                      : !isOnCurrentStepPage
                        ? "Go there"
                        : "Next"}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}