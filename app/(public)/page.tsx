import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Docs-only AI for agencies.
              <span className="block text-muted-foreground">
                No guessing. No leakage. No hallucinations.
              </span>
            </h1>

            <p className="mt-5 text-lg text-muted-foreground">
              Upload SOPs, playbooks, onboarding, and brand docs. Louis answers strictly from your files.
              If it’s not in the docs, it says so — exactly.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Start free
              </Link>
              <Link
                href="/pricing"
                className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
              >
                View pricing
              </Link>
            </div>

            <div className="mt-6 rounded-2xl border bg-card p-4">
              <div className="text-xs text-muted-foreground">If it’s not in your uploads:</div>
              <div className="mt-2 rounded-xl bg-muted p-3 font-mono text-sm">
                I don’t have that information in the docs yet.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="grid gap-4">
              <MockCard title="Upload your docs" body="SOPs, onboarding, offers, pricing, brand guides." />
              <MockCard title="Ask anything" body="“What’s our onboarding checklist?”" />
              <MockCard
                title="Get a grounded answer"
                body="Answers cite your docs (and never invent anything)."
              />
              <div className="rounded-2xl border p-4">
                <div className="text-sm font-medium">Private by design</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Each agency is isolated. Your knowledge base stays yours.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 md:grid-cols-3">
            <Feature
              title="Docs-only enforcement"
              body="Hard rule: if it’s not in the docs, Louis won’t answer."
            />
            <Feature
              title="Agency isolation"
              body="One workspace = one knowledge base. No cross-agency leakage."
            />
            <Feature
              title="Clean UX"
              body="Fast, simple, and built for real operations — not demos."
            />
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="rounded-3xl border bg-card p-8 md:p-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Ready to stop searching old docs?</h2>
                <p className="mt-2 text-muted-foreground">
                  Start on Free. Upgrade when your team is ready.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href="/signup"
                  className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Start free
                </Link>
                <Link
                  href="/pricing"
                  className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
                >
                  Pricing
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}

function MockCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}
