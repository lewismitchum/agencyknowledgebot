// app/(public)/verify-email/page.tsx
import { Suspense } from "react";
import VerifyEmailClient from "./verify-email-client";

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
          <div className="mx-auto max-w-xl">
            <div className="rounded-3xl border bg-card p-8 shadow-sm">
              <div className="text-sm text-muted-foreground">Loading…</div>
            </div>
          </div>
        </div>
      }
    >
      <VerifyEmailClient />
    </Suspense>
  );
}