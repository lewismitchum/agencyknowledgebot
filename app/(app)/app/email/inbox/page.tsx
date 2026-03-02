"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EmailInboxRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/email");
  }, [router]);

  return <div className="p-6 text-sm text-muted-foreground">Redirecting…</div>;
}