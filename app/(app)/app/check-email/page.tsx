// app/(app)/app/check-email/page.tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AppCheckEmailPage() {
  // check-email is a public route; keep /app/check-email as a safe redirect
  redirect("/check-email");
}