// app/(app)/app/page.tsx
export const runtime = "nodejs";

type MePayload = {
  ok?: boolean;
  agency?: { plan?: string };
  documents_count?: number;
  daily_remaining?: number | null;
  daily_resets_in_seconds?: number;
};

async function getMe() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/me`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as MePayload;
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

  const docs = me?.documents_count ?? null;
  const remaining = me?.daily_remaining;
  const reset =
    me?.daily_resets_in_seconds != null ? formatCountdown(me.daily_resets_in_seconds) : null;

  const remainingLabel =
    remaining == null ? "Unlimited" : String(remaining);

  const remainingSub =
    remaining == null
      ? "No daily chat limit on your plan"
      : `Resets in ${reset ?? "—"} (America/Chicago)`;

  const plan =
    me?.agency?.plan ? String(me.agency.plan).toUpperCase() : "—";

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
          value={docs == null ? "—" : String(docs)}
          sub="Uploads in your workspace"
        />

        <StatCard
          title="Messages left today"
          value={remainingLabel}
          sub={remainingSub}
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
          body="Docs are prioritized. For internal questions, Louis uses your uploaded files first."
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

function StatCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{sub}</div>
    </div>
  );
}

function Panel({ title, body, footer }: { title: string; body: string; footer?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </div>
  );
}