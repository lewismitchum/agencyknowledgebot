export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { headers } from "next/headers";

type MeApiResponse =
  | {
      ok: true;
      agency: { plan: string };
      documents_count: number;
      daily_remaining: number;
      daily_resets_in_seconds: number;
    }
  | { ok?: false; error?: string; message?: string };

async function getOriginFromHeaders() {
  const h = await headers();

  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host");

  if (host) return `${proto}://${host}`;

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

async function getMe() {
  try {
    const h = await headers();
    const cookie = h.get("cookie") || "";
    const origin = await getOriginFromHeaders();

    const res = await fetch(`${origin}/api/me`, {
      cache: "no-store",
      headers: {
        cookie, // ✅ forward auth cookie
      },
    });

    const data = (await res.json().catch(() => ({}))) as MeApiResponse;
    if (!res.ok || !(data as any)?.ok) return null;

    return data as Extract<MeApiResponse, { ok: true }>;
  } catch {
    return null;
  }
}

function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}h ${pad(m)}m ${pad(sec)}s`;
}

export default async function DashboardPage() {
  const me = await getMe();

  const docs = me?.documents_count ?? "—";
  const remaining = me?.daily_remaining ?? "—";
  const reset =
    me?.daily_resets_in_seconds != null
      ? formatCountdown(me.daily_resets_in_seconds)
      : "—";

  const plan = me?.agency?.plan ? String(me.agency.plan).toUpperCase() : "—";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          Workspace health at a glance.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Documents"
          value={String(docs)}
          sub="Uploads in your workspace"
        />
        <StatCard
          title="Messages left today"
          value={String(remaining)}
          sub={`Resets in ${reset} (America/Chicago)`}
        />
        <StatCard
          title="Plan"
          value={plan}
          sub="Plan limits are enforced server-side"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel
          title="How Louis answers"
          body="Docs are prioritized. For internal business questions, Louis won’t guess if your docs don’t contain the answer."
          footer={
            <div className="rounded-xl bg-muted p-3 font-mono text-sm">
              I don’t have that information in the docs yet.
            </div>
          }
        />
        <Panel
          title="Recommended next upload"
          body="Start with SOPs, onboarding, offer docs, pricing, brand guidelines, and client deliverable templates."
          footer={
            <div className="flex flex-wrap gap-3">
              <a
                href="/app/docs"
                className="inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Upload docs
              </a>
              <a
                href="/app/chat"
                className="inline-flex rounded-xl border px-4 py-2 text-sm hover:bg-accent"
              >
                Open chat
              </a>
            </div>
          }
        />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{sub}</div>
    </div>
  );
}

function Panel({
  title,
  body,
  footer,
}: {
  title: string;
  body: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </div>
  );
}