// app/(public)/pricing/page.tsx
import Link from "next/link";
import PricingCTA from "./pricing-cta";

export default function PricingPage() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Pricing that scales with your agency.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Start on Free. Upgrade when your team is ready. Louis is docs-first for
            business answers: it prioritizes your uploads and stays honest when the docs
            don’t support an internal answer.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Paid feature note:</span>{" "}
            schedule/to-do/calendar extraction is available on home+ (server-side
            enforced).
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-5">
          <PlanCard
            name="Free"
            price="$0"
            cadence="/mo"
            highlight="Docs-first • 20 msgs/day"
            bullets={[
              "1 agency bot",
              "Docs-first grounding for internal answers",
              "Safe fallback when docs don’t support an internal question",
              "No schedule/to-do/calendar",
              "5 daily uploads (docs only)",
            ]}
            ctaLabel="Start free"
            ctaHref="/signup"
            variant="outline"
          />

          <PlanCard
            name="home"
            price="$79–$99"
            cadence="/mo"
            highlight="Schedule + extraction"
            bullets={[
              "1 agency bot",
              "Up to 5 users (owner/admin excluded from seats)",
              "500 daily chats",
              "Unlimited uploads (docs only)",
              "Schedule/to-do/calendar enabled",
            ]}
            ctaLabel="Upgrade"
            ctaHref="/app/billing"
            variant="primary"
            badge="Most popular"
          />

          <PlanCard
            name="Pro"
            price="$249–$399"
            cadence="/mo"
            highlight="Multimedia + schedule"
            bullets={[
              "3 agency bots",
              "Up to 15 users (owner/admin excluded from seats)",
              "Unlimited daily chats",
              "Uploads (docs + images + video)",
              "Schedule/to-do/calendar enabled",
            ]}
            ctaLabel="Upgrade"
            ctaHref="/app/billing"
            variant="outline"
          />

          <PlanCard
            name="Enterprise"
            price="$899–$999"
            cadence="/mo"
            highlight="Teams"
            bullets={[
              "5 agency bots",
              "Up to 50 users (owner/admin excluded from seats)",
              "Unlimited daily chats",
              "Uploads (docs + images + video)",
              "Schedule/to-do/calendar enabled",
            ]}
            ctaLabel="Upgrade"
            ctaHref="/app/billing"
            variant="outline"
          />

          <PlanCard
            name="Corporation"
            price="$1799–$1999"
            cadence="/mo"
            highlight="Email + AI triage"
            bullets={[
              "10 agency bots",
              "Up to 100 users (owner/admin excluded from seats)",
              "Unlimited daily chats",
              "Uploads (docs + images + video)",
              "Schedule/to-do/calendar enabled",
              "Email page enabled (Gmail-like)",
            ]}
            ctaLabel="Upgrade"
            ctaHref="/app/billing"
            variant="outline"
          />
        </div>

        <div className="mt-10 rounded-3xl border bg-card p-8 md:p-10">
          <h2 className="text-2xl font-semibold tracking-tight">
            The reliability rule (for internal questions)
          </h2>
          <p className="mt-2 text-muted-foreground">
            For internal/business questions, Louis won’t invent an answer. If the docs
            don’t support it, it replies exactly:
          </p>

          <div className="mt-5 rounded-2xl bg-muted p-4 font-mono text-sm">
            I don’t have that information in the docs yet.
          </div>

          <PricingCTA />
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <MiniCard
            title="Isolation by design"
            body="Each agency is isolated. Knowledge never crosses workspaces."
          />
          <MiniCard
            title="Honest uncertainty"
            body="When docs don’t support an internal answer, Louis says so — clearly."
          />
          <MiniCard
            title="Built for real ops"
            body="Designed for SOPs, onboarding, pricing, deliverables, and brand docs."
          />
        </div>

        <div className="mt-12 rounded-3xl border bg-card p-8 md:p-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Ready to stop searching old docs?
              </h2>
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
                href="/app/billing"
                className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
              >
                Upgrade
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  name,
  price,
  cadence,
  highlight,
  bullets,
  ctaLabel,
  ctaHref,
  variant,
  disabled,
  badge,
}: {
  name: string;
  price: string;
  cadence: string;
  highlight: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: string;
  variant: "primary" | "outline";
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div className="relative rounded-2xl border bg-card p-5 shadow-sm">
      {badge ? (
        <div className="absolute -top-3 left-5 rounded-full border bg-background px-3 py-1 text-xs font-medium">
          {badge}
        </div>
      ) : null}

      <div className="text-sm font-semibold">{name}</div>

      <div className="mt-3 flex items-end gap-1">
        <div className="text-3xl font-semibold">{price}</div>
        {cadence ? (
          <div className="pb-1 text-sm text-muted-foreground">{cadence}</div>
        ) : null}
      </div>

      <div className="mt-2 text-sm text-muted-foreground">{highlight}</div>

      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <Link
        aria-disabled={disabled}
        href={disabled ? "#" : ctaHref}
        className={[
          "mt-5 inline-flex w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-medium",
          disabled
            ? "cursor-not-allowed bg-muted text-muted-foreground"
            : variant === "primary"
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "border hover:bg-accent",
        ].join(" ")}
      >
        {ctaLabel}
      </Link>

      {disabled ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Checkout will be enabled after billing setup.
        </p>
      ) : null}
    </div>
  );
}

function MiniCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}