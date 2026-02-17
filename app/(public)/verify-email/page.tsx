import Link from "next/link";

export const runtime = "nodejs";

async function verifyToken(token: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/auth/verify-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.ok, error: data?.error as string | undefined };
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const token = (searchParams?.token || "").trim();

  let result: { ok: boolean; error?: string } | null = null;

  if (token) {
    // Server Component: run verification on the server (no client JS required)
    result = await verifyToken(token);
  }

  const title = !token
    ? "Missing verification token"
    : result?.ok
    ? "Email verified 🎉"
    : "Verification failed";

  const message = !token
    ? "This link is missing a token. Please use the verification link from your email."
    : result?.ok
    ? "Your workspace is now active. You can log in."
    : result?.error || "That link is invalid or expired. Please request a new one.";

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>

          {!result?.ok && (
            <div className="mt-6 rounded-2xl border bg-muted p-4 text-sm text-muted-foreground">
              If you don’t see the latest email, check spam/promotions and search for “Louis.Ai”.
              If it expired, you’ll need a fresh link.
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Back to login
            </Link>
            <Link
              href="/"
              className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
            >
              Home
            </Link>
          </div>

          <div className="mt-8 rounded-2xl bg-muted p-4">
            <div className="text-xs text-muted-foreground">Reminder:</div>
            <div className="mt-2 font-mono text-sm">
              Louis prioritizes your uploaded docs for internal answers.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
