import { Suspense } from "react";
import CheckEmailClient from "./check-email-client";

export const dynamic = "force-dynamic";

export default function CheckEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border bg-white/70 dark:bg-black/20 backdrop-blur p-6 shadow-sm">
            <div className="text-sm text-muted-foreground">Loading…</div>
          </div>
        </div>
      }
    >
      <CheckEmailClient />
    </Suspense>
  );
}