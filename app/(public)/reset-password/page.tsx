// app/(public)/reset-password/page.tsx
import { Suspense } from "react";

const ResetPasswordClient = () => {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border bg-card p-8 shadow-sm">
          <h1 className="text-lg font-medium">Reset Password</h1>
          <p className="text-sm text-muted-foreground">This is a placeholder reset password form.</p>
        </div>
      </div>
    </div>
  );
};

export default function ResetPasswordPage() {
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
      <ResetPasswordClient />
    </Suspense>
  );
}