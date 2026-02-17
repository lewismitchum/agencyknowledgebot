"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function AcceptInvitePage() {
  const sp = useSearchParams();
  const token = useMemo(() => (sp.get("token") || "").trim(), [sp]);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);

    if (!token) {
      setResult({ ok: false, error: "Missing token" });
      return;
    }
    if (password.length < 8) {
      setResult({ ok: false, error: "Password must be at least 8 characters" });
      return;
    }
    if (password !== password2) {
      setResult({ ok: false, error: "Passwords do not match" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setResult({ ok: false, error: data?.error || "Invite failed" });
      } else {
        setResult({ ok: true });
      }
    } catch (err: any) {
      setResult({ ok: false, error: err?.message || "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.05),transparent_50%)]" />
      </div>

      <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
        <div className="mx-auto max-w-xl">
          <div className="rounded-3xl border bg-card p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">Join workspace</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a password to finish joining. Your account may require owner approval before you can access the app.
            </p>

            {!token && (
              <div className="mt-6 rounded-2xl border bg-muted p-4 text-sm text-muted-foreground">
                This invite link is missing a token. Please use the link from your email.
              </div>
            )}

            {result && (
              <div
                className={[
                  "mt-6 rounded-2xl border p-4 text-sm",
                  result.ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10",
                ].join(" ")}
              >
                {result.ok ? (
                  <div>
                    <div className="font-medium">Invite accepted ✅</div>
                    <div className="mt-1 text-muted-foreground">
                      You can now log in. If your owner requires approval, you’ll see “Pending approval”.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="font-medium">Could not accept invite</div>
                    <div className="mt-1 text-muted-foreground">{result.error}</div>
                  </div>
                )}
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div>
                <label className="text-sm font-medium">Password</label>
                <input
                  className="mt-2 w-full rounded-xl border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || !token || (result?.ok ?? false)}
                  placeholder="At least 8 characters"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Confirm password</label>
                <input
                  className="mt-2 w-full rounded-xl border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  disabled={loading || !token || (result?.ok ?? false)}
                  placeholder="Repeat password"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !token || (result?.ok ?? false)}
                className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Creating account..." : "Accept invite"}
              </button>
            </form>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="rounded-xl border px-5 py-3 text-sm hover:bg-accent"
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
          </div>
        </div>
      </div>
    </div>
  );
}
