import Link from "next/link";

export default function LaunchPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="grid gap-8 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Louis.Ai is ready.
            <span className="block text-muted-foreground">
              Now we turn on growth.
            </span>
          </h1>

          <p className="mt-5 text-lg text-muted-foreground">
            Docs-only, production-safe, and built for agencies. Upload SOPs,
            playbooks, onboarding, and pricing docs — Louis answers strictly from
            what you provide.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Start free
            </Link>
            <Link
              href="/app"
              className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
            >
              Open app
            </Link>
            <Link
              href="/pricing"
              className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
            >
              Pricing
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Hard rule:</div>
            <div className="mt-2 rounded-xl bg-muted p-3 font-mono text-sm">
              I don’t have that information in the docs yet.
            </div>
          </div>
        </div>

        <div className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="grid gap-4">
            <Block title="1) Upload docs" body="SOPs, onboarding, pricing, brand guidelines, deliverables." />
            <Block title="2) Ask questions" body="“What’s our onboarding checklist?” “What’s our revision policy?”" />
            <Block title="3) Get grounded answers" body="Louis uses only your docs — never invents." />

            <div className="rounded-2xl border p-5">
              <div className="text-sm font-semibold">Next backend switch</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Billing (Stripe) — enable checkout + webhook to set your plan.
              </p>
              <div className="mt-4 flex gap-2">
                <Link
                  href="/app/billing"
                  className="inline-flex rounded-xl border px-4 py-2 text-sm hover:bg-accent"
                >
                  View billing UI
                </Link>
                <Link
                  href="/app/docs"
                  className="inline-flex rounded-xl border px-4 py-2 text-sm hover:bg-accent"
                >
                  Upload docs
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <Mini title="Isolation" body="One workspace = one knowledge base. No cross-agency leakage." />
        <Mini title="Reliable" body="Graceful fallback on errors and limits. No hallucinations." />
        <Mini title="Fast UX" body="Clean UI, clear limits, and zero wasted requests." />
      </div>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}

function Mini({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}
