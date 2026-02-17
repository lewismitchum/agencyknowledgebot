// app/(app)/app/billing/page.tsx
import { Suspense } from "react";
import BillingClient from "./BillingClient";

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading billing…</div>}>
      <BillingClient />
    </Suspense>
  );
}
