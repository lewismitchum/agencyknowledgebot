// app/(app)/app/billing/page.tsx
import BillingClient from "./BillingClient";

export default function BillingPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const success = typeof searchParams?.success === "string" ? searchParams?.success : "";
  const canceled = typeof searchParams?.canceled === "string" ? searchParams?.canceled : "";

  return <BillingClient initialSuccess={success} initialCanceled={canceled} />;
}
