// app/join/page.tsx
import Link from "next/link";

type JoinPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(
  searchParams: JoinPageProps["searchParams"],
  key: string
): string | null {
  const v = searchParams?.[key];
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default async function JoinPage({ searchParams }: JoinPageProps) {
  // Accept common param names we’ve used historically
  const token =
    getParam(searchParams, "token") ||
    getParam(searchParams, "invite") ||
    getParam(searchParams, "t");

  const agencyHint =
    getParam(searchParams, "agency") || getParam(searchParams, "agency_name");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Join Agency</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use your invite link to join an agency.
        </p>

        <div className="mt-4 space-y-2 text-sm">
          <div>
            <span className="font-medium">Invite token:</span>{" "}
            <span className="font-mono">{token ?? "missing"}</span>
          </div>
          {agencyHint ? (
            <div>
              <span className="font-medium">Agency:</span>{" "}
              <span>{agencyHint}</span>
            </div>
          ) : null}
        </div>

        {!token ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            This invite link is missing a token. Ask your agency owner/admin for
            a fresh invite link.
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <form action="/api/agency/accept-invite" method="POST">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-black/90"
              >
                Accept Invite
              </button>
            </form>

            <p className="text-xs text-muted-foreground">
              If you’re not signed in, you may be redirected to log in first.
            </p>
          </div>
        )}
      </div>

      <div className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="underline hover:text-foreground">
          Go to login
        </Link>
        {" · "}
        <Link href="/signup" className="underline hover:text-foreground">
          Create account
        </Link>
      </div>
    </main>
  );
}