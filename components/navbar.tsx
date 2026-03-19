"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  CalendarDays,
  Bell,
  MoreHorizontal,
  Bot,
  CreditCard,
  LifeBuoy,
  Rocket,
  Mail,
  Sheet as SheetIcon,
  Brain,
  Target,
} from "lucide-react";
import { fetchJson, FetchJsonError } from "@/lib/fetch-json";

type MeResponse =
  | { user: null }
  | {
      user: {
        id: string;
        email: string;
        name?: string;
        email_verified?: boolean;
      };
    };

type BotRow = {
  id: string;
  name: string;
  owner_user_id: string | null;
  vector_store_id: string | null;
};

type DocRow = {
  id: string;
  filename: string;
  openai_file_id: string | null;
  created_at: string;
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={[
        "relative text-sm font-medium",
        "rounded-full px-4 py-1.5",
        "transition-all duration-200",
        "hover:-translate-y-[1px]",
        active
          ? "bg-muted text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

function shortFilename(name: string, max = 28) {
  const s = String(name || "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(10, max - 10)) + "…" + s.slice(-8);
}

function UnreadPill({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold text-background">
      {count > 99 ? "99+" : String(count)}
    </span>
  );
}

function MobileTabButton({
  onGo,
  label,
  icon,
  active,
  badge,
}: {
  onGo: () => void;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onGo}
      className={[
        "relative flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] transition-colors",
        "min-w-[68px] shrink-0",
        "active:scale-[0.98]",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      <span
        className={[
          "relative inline-flex h-9 w-9 items-center justify-center rounded-xl",
          active ? "bg-muted" : "hover:bg-muted/60",
        ].join(" ")}
      >
        {icon}
        {badge && badge > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold text-background">
            {badge > 99 ? "99+" : String(badge)}
          </span>
        ) : null}
      </span>
      <span className="leading-none">{label}</span>
    </button>
  );
}

function MobileNav({ activeBotId, notifUnread }: { activeBotId: string; notifUnread: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const docsHref = useMemo(() => {
    return `/app/docs${activeBotId ? `?bot_id=${encodeURIComponent(activeBotId)}` : ""}`;
  }, [activeBotId]);

  const isActive = (p: string) => pathname === p;
  const starts = (p: string) => pathname.startsWith(p);

  const show = starts("/app");

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const activeEl = el.querySelector('[data-active="true"]') as HTMLElement | null;
    if (!activeEl) return;

    const left = activeEl.offsetLeft - el.clientWidth / 2 + activeEl.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [pathname]);

  useEffect(() => {
    if (!show) return;

    function applyPadding() {
      try {
        const isDesktop = window.matchMedia("(min-width: 768px)").matches;
        if (isDesktop) {
          document.body.style.paddingBottom = "";
          return;
        }
        document.body.style.paddingBottom = "calc(env(safe-area-inset-bottom) + 76px)";
      } catch {
        // ignore
      }
    }

    applyPadding();
    window.addEventListener("resize", applyPadding);
    return () => {
      window.removeEventListener("resize", applyPadding);
      document.body.style.paddingBottom = "";
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      className={[
        "fixed bottom-0 left-0 right-0 z-50 md:hidden",
        "border-t bg-background/90 backdrop-blur",
        "pb-[env(safe-area-inset-bottom)]",
      ].join(" ")}
    >
      <div className="mx-auto w-full max-w-6xl px-2 py-2">
        <div
          ref={scrollerRef}
          className={[
            "flex items-stretch gap-1",
            "overflow-x-auto overscroll-x-contain",
            "[-webkit-overflow-scrolling:touch]",
            "snap-x snap-mandatory",
            "scrollbar-none",
            "pr-4",
          ].join(" ")}
          style={{ touchAction: "pan-x" }}
        >
          <div className="flex items-stretch gap-1">
            <div className="snap-start">
              <div data-active={isActive("/app") ? "true" : "false"}>
                <MobileTabButton
                  label="Dash"
                  icon={<LayoutDashboard className="h-5 w-5" />}
                  active={isActive("/app")}
                  onGo={() => router.push("/app")}
                />
              </div>
            </div>

            <div className="snap-start">
              <div data-active={starts("/app/brain") ? "true" : "false"}>
                <MobileTabButton
                  label="Brain"
                  icon={<Brain className="h-5 w-5" />}
                  active={starts("/app/brain")}
                  onGo={() => router.push("/app/brain")}
                />
              </div>
            </div>

            <div className="snap-start">
              <div data-active={starts("/app/chat") ? "true" : "false"}>
                <MobileTabButton
                  label="Chat"
                  icon={<MessageSquare className="h-5 w-5" />}
                  active={starts("/app/chat")}
                  onGo={() => router.push("/app/chat")}
                />
              </div>
            </div>

            <div className="snap-start">
              <div data-active={starts("/app/docs") ? "true" : "false"}>
                <MobileTabButton
                  label="Docs"
                  icon={<FileText className="h-5 w-5" />}
                  active={starts("/app/docs")}
                  onGo={() => router.push(docsHref)}
                />
              </div>
            </div>

            <div className="snap-start">
              <div data-active={starts("/app/schedule") ? "true" : "false"}>
                <MobileTabButton
                  label="Schedule"
                  icon={<CalendarDays className="h-5 w-5" />}
                  active={starts("/app/schedule")}
                  onGo={() => router.push("/app/schedule")}
                />
              </div>
            </div>

            <div className="snap-start">
              <div data-active={starts("/app/notifications") ? "true" : "false"}>
                <MobileTabButton
                  label="Notifs"
                  icon={<Bell className="h-5 w-5" />}
                  active={starts("/app/notifications")}
                  badge={notifUnread}
                  onGo={() => router.push("/app/notifications")}
                />
              </div>
            </div>

            <div className="snap-start">
              <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className={[
                      "relative flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] transition-colors",
                      "min-w-[68px] shrink-0",
                      "active:scale-[0.98]",
                      moreOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                    aria-label="More"
                  >
                    <span
                      className={[
                        "relative inline-flex h-9 w-9 items-center justify-center rounded-xl",
                        moreOpen ? "bg-muted" : "hover:bg-muted/60",
                      ].join(" ")}
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </span>
                    <span className="leading-none">More</span>
                  </button>
                </SheetTrigger>

                <SheetContent side="bottom" className="rounded-t-2xl">
                  <div className="mx-auto w-full max-w-2xl">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold">More</div>
                      <div className="text-xs text-muted-foreground">Quick access</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={[
                          "flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted",
                          starts("/app/bots") ? "bg-muted" : "",
                        ].join(" ")}
                        onClick={() => {
                          setMoreOpen(false);
                          router.push("/app/bots");
                        }}
                      >
                        <Bot className="h-4 w-4" />
                        Bots
                      </button>

                      <button
                        type="button"
                        className={[
                          "flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted",
                          starts("/app/billing") ? "bg-muted" : "",
                        ].join(" ")}
                        onClick={() => {
                          setMoreOpen(false);
                          router.push("/app/billing");
                        }}
                      >
                        <CreditCard className="h-4 w-4" />
                        Billing
                      </button>

                      <button
                        type="button"
                        className={[
                          "flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted",
                          starts("/app/email") ? "bg-muted" : "",
                        ].join(" ")}
                        onClick={() => {
                          setMoreOpen(false);
                          router.push("/app/email");
                        }}
                      >
                        <Mail className="h-4 w-4" />
                        Email
                      </button>

                      <button
                        type="button"
                        className={[
                          "flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted",
                          starts("/app/spreadsheets") ? "bg-muted" : "",
                        ].join(" ")}
                        onClick={() => {
                          setMoreOpen(false);
                          router.push("/app/spreadsheets");
                        }}
                      >
                        <SheetIcon className="h-4 w-4" />
                        Sheets
                      </button>

                      <button
                        type="button"
                        className={[
                          "flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted",
                          starts("/app/outreach") ? "bg-muted" : "",
                        ].join(" ")}
                        onClick={() => {
                          setMoreOpen(false);
                          router.push("/app/spreadsheets");
                        }}
                      >
                        <Target className="h-4 w-4" />
                        Outreach
                      </button>

                      <button
                        type="button"
                        className={[
                          "flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted",
                          starts("/app/support") ? "bg-muted" : "",
                        ].join(" ")}
                        onClick={() => {
                          setMoreOpen(false);
                          router.push("/app/support");
                        }}
                      >
                        <LifeBuoy className="h-4 w-4" />
                        Support
                      </button>

                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setMoreOpen(false);
                          router.push("/launch");
                        }}
                      >
                        <Rocket className="h-4 w-4" />
                        Launch
                      </button>
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">Swipe the bottom tabs left/right to see everything.</div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="w-2 shrink-0" />
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-0 right-0 h-[72px] w-10 bg-gradient-to-l from-background/90 to-transparent" />
      </div>
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [me, setMe] = useState<MeResponse | null>(null);
  const isAuthed = Boolean(me && (me as any)?.user?.email);

  const botFromUrl = String(searchParams.get("bot_id") || "").trim();
  const [bots, setBots] = useState<BotRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [activeBotId, setActiveBotId] = useState<string>(botFromUrl);

  const [docsOpen, setDocsOpen] = useState(false);
  const [loadingBots, setLoadingBots] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [botsError, setBotsError] = useState<string | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);

  const docsPanelRef = useRef<HTMLDivElement | null>(null);

  const [notifUnread, setNotifUnread] = useState(0);

  useEffect(() => {
    if (botFromUrl && botFromUrl !== activeBotId) setActiveBotId(botFromUrl);
  }, [botFromUrl, activeBotId]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!docsOpen) return;
      const el = docsPanelRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setDocsOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [docsOpen]);

  useEffect(() => {
    setDocsOpen(false);
  }, [pathname]);

  useEffect(() => {
    (async () => {
      try {
        const j = (await fetchJson("/api/me")) as MeResponse;
        setMe(j);
      } catch (e: any) {
        if (e instanceof FetchJsonError && (e.info.status === 401 || e.info.status === 403)) {
          setMe({ user: null });
          return;
        }
        setMe({ user: null });
      }
    })();
  }, []);

  useEffect(() => {
    if (!isAuthed) return;

    let cancelled = false;

    (async () => {
      try {
        setLoadingBots(true);
        setBotsError(null);

        const j: any = await fetchJson("/api/bots", { cache: "no-store" });
        const list = Array.isArray(j?.bots) ? (j.bots as BotRow[]) : [];
        if (cancelled) return;

        setBots(list);

        if (!activeBotId) {
          const agencyBot = list.find((b) => b.owner_user_id == null);
          const fallback = agencyBot?.id || list[0]?.id || "";
          setActiveBotId(fallback);
        }
      } catch (e: any) {
        if (cancelled) return;

        if (e instanceof FetchJsonError) {
          const body = String(e.info.bodyText || "").trim();
          setBotsError(body || `Failed to load bots (${e.info.status})`);
        } else {
          setBotsError(String(e?.message ?? e));
        }
      } finally {
        if (!cancelled) setLoadingBots(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, activeBotId]);

  useEffect(() => {
    if (!isAuthed) return;
    if (!activeBotId) {
      setDocs([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoadingDocs(true);
        setDocsError(null);

        const j: any = await fetchJson(`/api/documents?bot_id=${encodeURIComponent(activeBotId)}`, { cache: "no-store" });
        const list = Array.isArray(j?.documents) ? (j.documents as DocRow[]) : [];
        if (cancelled) return;

        setDocs(list);
      } catch (e: any) {
        if (cancelled) return;
        if (e instanceof FetchJsonError) {
          const body = String(e.info.bodyText || "").trim();
          setDocsError(body || `Failed to load docs (${e.info.status})`);
        } else {
          setDocsError(String(e?.message ?? e));
        }
        setDocs([]);
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, activeBotId]);

  useEffect(() => {
    if (!isAuthed) {
      setNotifUnread(0);
      return;
    }

    let cancelled = false;

    async function loadUnread() {
      try {
        const j: any = await fetchJson("/api/notifications/list?limit=50", { cache: "no-store" });

        if (j?.upsell?.code) {
          if (!cancelled) setNotifUnread(0);
          return;
        }

        const list = Array.isArray(j?.notifications) ? j.notifications : [];
        const unread = list.filter((n: any) => !n?.read_at).length;

        if (!cancelled) setNotifUnread(Number(unread) || 0);
      } catch {
        // silent
      }
    }

    loadUnread();
    const id = window.setInterval(loadUnread, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isAuthed]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  const email = (me as any)?.user?.email as string | undefined;
  const emailVerified = Boolean((me as any)?.user?.email_verified);

  const activeBotLabel = useMemo(() => {
    const b = bots.find((x) => x.id === activeBotId);
    if (!b) return "Docs";
    return b.owner_user_id == null ? `Docs (Agency)` : `Docs (Private)`;
  }, [bots, activeBotId]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b bg-background/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/app" className="group flex items-center gap-2">
            <div className="badge-glow relative overflow-hidden rounded-full px-3 py-1.5">
              <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(600px_200px_at_20%_0%,hsl(var(--primary)/0.16),transparent_60%)]" />
              <span className="relative text-sm font-semibold tracking-tight">
                Louis<span className="text-muted-foreground">.Ai</span>
              </span>
            </div>

            <span className="hidden text-sm text-muted-foreground md:block">Docs-prioritized AI for agencies</span>
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            <NavLink href="/app">Dashboard</NavLink>
            <NavLink href="/app/brain">Agency Brain</NavLink>
            <NavLink href="/app/chat">Chat</NavLink>

            <div className="relative" ref={docsPanelRef}>
              <button
                type="button"
                onClick={() => setDocsOpen((v) => !v)}
                className={[
                  "text-sm transition-colors",
                  "rounded-full px-3 py-1.5",
                  pathname.startsWith("/app/docs")
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                {activeBotLabel}
              </button>

              {docsOpen ? (
                <div className="absolute right-0 mt-2 w-[360px] rounded-xl border bg-background p-3 shadow-lg">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Docs</div>

                    <Link
                      href={`/app/docs${activeBotId ? `?bot_id=${encodeURIComponent(activeBotId)}` : ""}`}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setDocsOpen(false)}
                    >
                      Open Docs page
                    </Link>
                  </div>

                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Bot:</span>
                      <select
                        className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
                        value={activeBotId}
                        onChange={(e) => setActiveBotId(e.target.value)}
                        disabled={loadingBots || bots.length === 0}
                      >
                        {bots.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} {b.owner_user_id == null ? "(Agency)" : "(Private)"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 max-h-[280px] overflow-auto rounded-lg border">
                    {loadingBots ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">Loading bots…</div>
                    ) : botsError ? (
                      <div className="px-3 py-2 text-sm text-red-500">{botsError}</div>
                    ) : loadingDocs ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">Loading docs…</div>
                    ) : docsError ? (
                      <div className="px-3 py-2 text-sm text-red-500">{docsError}</div>
                    ) : docs.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No docs for this bot.</div>
                    ) : (
                      <div className="flex flex-col">
                        {docs.map((d) => (
                          <Link
                            key={d.id}
                            href={`/app/docs?bot_id=${encodeURIComponent(activeBotId)}&doc_id=${encodeURIComponent(d.id)}`}
                            className="px-3 py-2 text-sm hover:bg-muted"
                            title={d.filename}
                            onClick={() => setDocsOpen(false)}
                          >
                            {shortFilename(d.filename)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 text-[11px] text-muted-foreground">This list is scoped to the selected bot.</div>
                </div>
              ) : null}
            </div>

            <NavLink href="/app/schedule">Schedule</NavLink>
            <NavLink href="/app/spreadsheets">Spreadsheets</NavLink>
            <NavLink href="/app/spreadsheets">Outreach</NavLink>

            <Link
              href="/app/notifications"
              className={[
                "text-sm transition-colors",
                "rounded-full px-3 py-1.5",
                pathname === "/app/notifications"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              <span className="inline-flex items-center">
                Notifications
                <UnreadPill count={notifUnread} />
              </span>
            </Link>

            <NavLink href="/app/email">Email</NavLink>
            <NavLink href="/app/bots">Bots</NavLink>
            <NavLink href="/app/support">Support</NavLink>
            <NavLink href="/launch">Launch</NavLink>
          </nav>

          <div className="flex items-center gap-2">
            <ModeToggle />

            {me === null ? (
              <div className="hidden md:flex items-center gap-2">
                <div className="h-8 w-24 rounded-full bg-muted" />
              </div>
            ) : isAuthed ? (
              <div className="hidden md:flex items-center gap-2">
                <Badge
                  variant={emailVerified ? "secondary" : "outline"}
                  className="rounded-full"
                  title={emailVerified ? "Email verified" : "Email not verified"}
                >
                  {emailVerified ? "Verified" : "Unverified"}
                </Badge>

                <span className="max-w-[220px] truncate text-xs text-muted-foreground">{email}</span>

                <Button variant="outline" size="sm" className="rounded-full" onClick={logout}>
                  Logout
                </Button>
              </div>
            ) : (
              <Button asChild variant="outline" size="sm" className="hidden rounded-full md:inline-flex">
                <Link href="/login">Login</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <MobileNav activeBotId={activeBotId} notifUnread={notifUnread} />
    </>
  );
}