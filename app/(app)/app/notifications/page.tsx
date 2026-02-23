"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl">Notifications</CardTitle>
          <CardDescription>
            Reminders and alerts (coming next). This page exists so the nav link works.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            Planned:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Daily digest (today’s tasks + upcoming events)</li>
              <li>Due-soon reminders</li>
              <li>Email / in-app notifications (plan-gated later if you want)</li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/schedule">Open Schedule</Link>
            </Button>

            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/chat">Open Chat</Link>
            </Button>

            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/support">Support</Link>
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Next step when you’re ready: add a simple API that returns “due soon” tasks + next 7 days events.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}