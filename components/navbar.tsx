"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";

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

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={[
        "text-sm transition-colors",
        "rounded-full px-3 py-1.5",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
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

export default function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [me, setMe] = useState<MeResponse | null>(null);
  const isAuthed = Boolean(me && (me as any)?.user?.email);

  // --- Docs-in-nav state ---
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

  // Keep active bot in sync with URL param
  useEffect(() => {
    if (botFromUrl && botFromUrl !== activeBotId) setActiveBotId(botFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botFromUrl]);

  // Close docs panel on outside click / route change
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
        const r = await fetch("/api/me", { credentials: "include" });
        if (!r.ok) {
          setMe({ user: null });
          return;
        }
        const j = (await r.json().catch(() => ({ user: null }))) as MeResponse;
        setMe(j);
      } catch {
        setMe({ user: null });
      }
    })();
  }, []);

  // Load bots (for docs panel)
  useEffect(() => {
    if (!isAuthed) return;

    let cancelled = false;

    (async () => {
      try {
        setLoadingBots(true);
        setBotsError(null);

        const r = await fetch("/api/bots", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));

        if (!r.ok) throw new Error(String(j?.error || "Failed to load bots"));

        const list = Array.isArray(j?.bots) ? (j.bots as BotRow[]) : [];
        if (cancelled) return;

        setBots(list);

        // If we don't have an active bot yet, prefer agency bot, else first.
        if (!activeBotId) {
          const agencyBot = list.find((b) => b.owner_user_id == null);
          const fallback = agencyBot?.id || list[0]?.id || "";
          setActiveBotId(fallback);
        }
      } catch (e: any) {
        if (cancelled) return;
        setBotsError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoadingBots(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  // Load docs for active bot
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

        const r = await fetch(`/api/documents?bot_id=${encodeURIComponent(activeBotId)}`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));

        if (!r.ok) throw new Error(String(j?.error || "Failed to load docs"));

        const list = Array.isArray(j?.documents) ? (j.documents as DocRow[]) : [];
        if (cancelled) return;

        setDocs(list);
      } catch (e: any) {
        if (cancelled) return;
        setDocsError(String(e?.message ?? e));
        setDocs([]);
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed, activeBotId]);

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
    <header className="sticky top-0 z-50 border-b bg-background/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 md:px-6">
        <Link href="/" className="group flex items-center gap-2">
          <div className="badge-glow relative overflow-hidden rounded-full px-3 py-1.5">
            <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(600px_200px_at_20%_0%,hsl(var(--primary)/0.16),transparent_60%)]" />
            <span className="relative text-sm font-semibold tracking-tight">
              Louis<span className="text-muted-foreground">.Ai</span>
            </span>
          </div>

          <span className="hidden text-sm text-muted-foreground md:block">
            Docs-prioritized AI for agencies
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-2 md:flex">
          <NavLink href="/app/chat">Chat</NavLink>

          {/* Docs dropdown (shows docs list) */}
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
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Docs
                  </div>

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
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No docs for this bot.
                    </div>
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

                <div className="mt-2 text-[11px] text-muted-foreground">
                  This list is scoped to the selected bot.
                </div>
              </div>
            ) : null}
          </div>

          <NavLink href="/app/bots">Bots</NavLink>
          <NavLink href="/launch">Launch</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          {/* Mobile quick links */}
          <div className="flex items-center gap-1 md:hidden">
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link href="/app/chat">Chat</Link>
            </Button>

            {/* Mobile docs opens docs page (dropdown UI is desktop-only here) */}
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link href={`/app/docs${activeBotId ? `?bot_id=${encodeURIComponent(activeBotId)}` : ""}`}>
                Docs
              </Link>
            </Button>

            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link href="/app/bots">Bots</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link href="/launch">Launch</Link>
            </Button>
          </div>

          <ModeToggle />

          {/* Auth area */}
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

              <span className="max-w-[220px] truncate text-xs text-muted-foreground">
                {email}
              </span>

              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={logout}
              >
                Logout
              </Button>
            </div>
          ) : (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden rounded-full md:inline-flex"
            >
              <Link href="/login">Login</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
