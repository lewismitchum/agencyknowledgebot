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
            Start on Free. Upgrade when your team is ready. Every plan keeps the
            non-negotiable rule: Louis answers only from your uploaded docs.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-4">
          <PlanCard
            name="Free"
            price="$0"
            cadence="/mo"
            highlight="Docs-only • 20 msgs/day"
            bullets={[
              "1 agency bot",
              "Docs-only knowledge base",
              "Strict fallback behavior",
              "Basic daily limit",
            ]}
            ctaLabel="Start free"
            ctaHref="/signup"
            variant="outline"
          />

          <PlanCard
            name="Starter"
            price="$—"
            cadence="/mo"
            highlight="Docs-only • Higher limits"
            bullets={[
              "1 agency bot",
              "Up to ~10 users",
              "Higher daily usage",
              "Priority indexing",
            ]}
            ctaLabel="Upgrade soon"
            ctaHref="/signup"
            variant="primary"
            disabled
            badge="Most popular"
          />

          <PlanCard
            name="Pro"
            price="$—"
            cadence="/mo"
            highlight="Docs + images • Higher limits"
            bullets={[
              "2–3 agency bots",
              "Up to ~25–50 users",
              "Docs + images",
              "Higher rate limits",
            ]}
            ctaLabel="Upgrade soon"
            ctaHref="/signup"
            variant="outline"
            disabled
          />

          <PlanCard
            name="Enterprise"
            price="Custom"
            cadence=""
            highlight="Full isolation • User bots"
            bullets={[
              "Up to 100 users",
              "Each user gets their own bot",
              "Docs + images + video",
              "Highest limits + support",
            ]}
            ctaLabel="Contact"
            ctaHref="/signup"
            variant="outline"
          />
        </div>

        <div className="mt-10 rounded-3xl border bg-card p-8 md:p-10">
          <h2 className="text-2xl font-semibold tracking-tight">
            The rule that makes Louis reliable
          </h2>
          <p className="mt-2 text-muted-foreground">
            Louis may only answer using uploaded documents. If the answer isn’t
            present, it must reply exactly:
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
            title="Graceful failure"
            body="If OpenAI errors or limits hit, Louis still returns the safe fallback."
          />
          <MiniCard
            title="Built for real ops"
            body="Designed for SOPs, onboarding, pricing, deliverables, and brand docs."
          />
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
