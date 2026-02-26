// app/pending-approval/page.tsx
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function PendingApprovalPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Pending approval</CardTitle>
              <CardDescription className="mt-1">
                Your request was submitted. An owner/admin must approve your account before you can log in.
              </CardDescription>
            </div>
            <Badge variant="secondary">Louis.Ai</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ask your agency owner/admin to open <span className="font-medium">Settings → Members</span> and activate
            your account.
          </p>

          <div className="flex gap-2">
            <Button asChild>
              <Link href="/login">Back to login</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/support">Contact support</Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            If you were invited, use the invite link instead (it activates immediately).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}