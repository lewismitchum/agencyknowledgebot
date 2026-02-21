// app/(public)/reset-password/page.tsx
import { Suspense } from "react";
import ResetPasswordClient from "./reset-password-client";

function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResetPasswordClient />
    </Suspense>
  );
}