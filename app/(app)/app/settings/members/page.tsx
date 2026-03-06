// app/(app)/app/settings/members/page.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type MemberRow = {
  id: string;
  email: string;
  email_verified?: number;
  role: string | null;
  status: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  created_at: string | null;
  expires_at: string | null;
};

type SeatsInfo = {
  used: number;
  pending_members?: number;
  pending_invites: number;
  reserved?: number;
  limit: number | null;
};

type EnforcementInfo = {
  can_create_invite?: boolean;
  can_activate_member?: boolean;
};

function prettyStatus(s: string | null) {
  const v = (s || "").toLowerCase();
  if (v === "active") return "Active";
  if (v === "pending") return "Pending";
  if (v === "blocked") return "Blocked";
  return "Unknown";
}

function prettyRole(r: string | null) {
  const v = (r || "").toLowerCase();
  if (v === "owner") return "Owner";
  if (v === "admin") return "Admin";
  return "Member";
}

function statusBadgeVariant(
  s: string | null
): "secondary" | "outline" | "destructive" {
  const v = (s || "").toLowerCase();
  if (v === "active") return "secondary";
  if (v === "pending") return "outline";
  if (v === "blocked") return "destructive";
  return "outline";
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function normRole(r: string | null): "owner" | "admin" | "member" {
  const v = String(r || "").toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function normStatus(s: string | null): "active" | "pending" | "blocked" {
  const v = String(s || "").toLowerCase();
  if (v === "active") return "active";
  if (v === "blocked") return "blocked";
  return "pending";
}

function SegButton(props: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className={[
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        props.active
          ? "border-foreground/20 bg-foreground text-background shadow-sm"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        props.disabled ? "cursor-not-allowed opacity-50 hover:bg-background" : "",
      ].join(" ")}
      type="button"
    >
      {props.children}
    </button>
  );
}

function StatPill(props: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div
      className={[
        "rounded-2xl border px-4 py-3",
        props.tone === "danger"
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100"
          : "border-border bg-background/70",
      ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </div>
      <div className="mt-1 text-sm font-semibold">{props.value}</div>
    </div>
  );
}

export default function MembersPage() {
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const [meRole, setMeRole] = useState<string | null>(null);
  const [meStatus, setMeStatus] = useState<string | null>(null);
  const [meUserId, setMeUserId] = useState<string | null>(null);

  const [plan, setPlan] = useState<string | null>(null);

  const [seats, setSeats] = useState<SeatsInfo | null>(null);
  const [enforcement, setEnforcement] = useState<EnforcementInfo | null>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);

  const [q, setQ] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  const [toast, setToast] = useState<string>("");
  const [lastInviteLink, setLastInviteLink] = useState<string>("");
  const [lastInviteEmailError, setLastInviteEmailError] = useState<string>("");

  const myRole = useMemo(() => normRole(meRole), [meRole]);
  const myStatus = useMemo(() => normStatus(meStatus), [meStatus]);

  const canManageMembers =
    myStatus === "active" && (myRole === "owner" || myRole === "admin");
  const canTransferOwnership = myStatus === "active" && myRole === "owner";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) => (m.email || "").toLowerCase().includes(needle));
  }, [members, q]);

  const canCreateInvite = useMemo(() => {
    if (!canManageMembers) return false;
    if (enforcement?.can_create_invite === false) return false;
    return true;
  }, [canManageMembers, enforcement]);

  const canActivateAnotherMember = useMemo(() => {
    if (enforcement?.can_activate_member === false) return false;
    return true;
  }, [enforcement]);

  const pendingCount = useMemo(
    () => members.filter((m) => normStatus(m.status) === "pending").length,
    [members]
  );

  const activeCount = useMemo(
    () => members.filter((m) => normStatus(m.status) === "active").length,
    [members]
  );

  const blockedCount = useMemo(
    () => members.filter((m) => normStatus(m.status) === "blocked").length,
    [members]
  );

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3500);
  }

  function seatLimitToast(j: any) {
    const used = Number(j?.seats?.used ?? seats?.used ?? 0);
    const reserved = Number(j?.seats?.reserved ?? seats?.reserved ?? 0);
    const limit = j?.seats?.limit ?? seats?.limit ?? null;

    if (limit == null) {
      showToast("Seat limit reached. Upgrade in Billing.");
      return;
    }

    if (typeof j?.mode === "string" && j.mode === "invite") {
      showToast(
        `Seat limit reached (${used} used, ${reserved} reserved, limit ${limit}). Upgrade in Billing.`
      );
      return;
    }

    showToast(`Seat limit reached (${used} / ${limit}). Upgrade in Billing.`);
  }

  async function loadAll() {
    setBootError("");
    setLoading(true);

    try {
      const meRes = await fetch("/api/me", { credentials: "include" });
      if (meRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!meRes.ok) {
        const raw = await meRes.text().catch(() => "");
        setBootError(raw || `Failed to load session (${meRes.status})`);
        return;
      }

      const meJson = await meRes.json().catch(() => null);

      const role = String(meJson?.user?.role ?? "");
      const status = String(meJson?.user?.status ?? "");
      const id = String(meJson?.user?.id ?? "");
      const p = String(meJson?.plan ?? meJson?.agency?.plan ?? "");

      setMeRole(role || null);
      setMeStatus(status || null);
      setMeUserId(id || null);
      setPlan(p || null);

      const nRole = normRole(role || null);
      const nStatus = normStatus(status || null);

      if (nStatus !== "active") {
        setBootError(
          nStatus === "pending"
            ? "Your account is pending approval. You can’t manage members yet."
            : "Your account is blocked. You can’t manage members."
        );
        return;
      }

      if (!(nRole === "owner" || nRole === "admin")) {
        setBootError("Owner/Admin only. You don’t have permission to manage members.");
        return;
      }

      const r = await fetch("/api/agency/users", { credentials: "include" });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (r.status === 403) {
        const j = await r.json().catch(() => null);
        const code = String(j?.error || "");
        if (code === "FORBIDDEN_NOT_ADMIN_OR_OWNER") {
          setBootError("Owner/Admin only. You don’t have permission to manage members.");
        } else if (code === "FORBIDDEN_NOT_ACTIVE") {
          setBootError("Your account is pending approval. You can’t manage members yet.");
        } else {
          setBootError(code || "Forbidden");
        }
        return;
      }

      if (!r.ok) {
        const raw = await r.text().catch(() => "");
        setBootError(raw || `Failed to load members (${r.status})`);
        return;
      }

      const j = await r.json().catch(() => null);

      setSeats(j?.seats ?? null);
      setEnforcement(j?.enforcement ?? null);
      setMembers(Array.isArray(j?.users) ? j.users : []);
      setInvites(Array.isArray(j?.invites) ? j.invites : []);
    } catch (e: any) {
      setBootError(e?.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateMember(
    userId: string,
    status: "pending" | "active" | "blocked",
    role: "owner" | "member" | "admin"
  ) {
    setSavingId(userId);
    try {
      const r = await fetch("/api/agency/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, status, role }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        const code = String(j?.code ?? j?.error ?? "");

        if (code === "USER_LIMIT_EXCEEDED") {
          seatLimitToast(j);
          await loadAll();
          return;
        }

        if (code === "SEAT_LIMIT_REACHED") {
          const used = Number(j?.seats?.used ?? seats?.used ?? 0);
          const limit = j?.seats?.limit ?? seats?.limit ?? null;
          showToast(
            limit == null
              ? "Seat limit reached."
              : `Seat limit reached (${used} / ${limit}). Upgrade in Billing.`
          );
          await loadAll();
          return;
        }

        alert(j?.error || `Update failed (${r.status})`);
        return;
      }

      await loadAll();
    } finally {
      setSavingId(null);
    }
  }

  async function removeMember(userId: string, email: string) {
    if (!canManageMembers) return;
    if (meUserId && userId === meUserId) return;

    const ok = window.confirm(
      `Remove ${email} from your agency?\n\nThey will lose access immediately.`
    );
    if (!ok) return;

    setSavingId(userId);
    try {
      const r = await fetch(`/api/agency/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        alert(j?.error || `Remove failed (${r.status})`);
        return;
      }

      showToast("Member removed.");
      await loadAll();
    } finally {
      setSavingId(null);
    }
  }

  async function revokeInvite(inviteId: string) {
    setSavingId(inviteId);
    try {
      const r = await fetch("/api/agency/invites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ invite_id: inviteId }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = await r.json().catch(() => null);
      if (!r.ok) {
        alert(j?.error || `Revoke failed (${r.status})`);
        return;
      }

      showToast("Invite revoked.");
      await loadAll();
    } finally {
      setSavingId(null);
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    setInviteBusy(true);
    setLastInviteLink("");
    setLastInviteEmailError("");

    try {
      const r = await fetch("/api/agency/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        const code = String(j?.code ?? j?.error ?? "");

        if (code === "USER_LIMIT_EXCEEDED") {
          seatLimitToast(j);
          await loadAll();
          return;
        }

        if (code === "SEAT_LIMIT_REACHED" || code === "SEAT_LIMIT_EXCEEDED") {
          seatLimitToast(j);
          await loadAll();
          return;
        }

        alert(j?.error || `Invite failed (${r.status})`);
        return;
      }

      setInviteEmail("");

      const link = String(j?.join_url ?? j?.link ?? "");
      const emailOk = j?.email_ok;
      const emailErr = String(j?.email_error ?? "");

      if (link) {
        setLastInviteLink(link);
        if (emailOk === false && emailErr) setLastInviteEmailError(emailErr);

        try {
          await navigator.clipboard.writeText(link);
          showToast(
            emailOk === false
              ? "Invite created. Email failed — link copied."
              : "Invite created. Link copied to clipboard."
          );
        } catch {
          showToast(emailOk === false ? "Invite created. Email failed." : "Invite created.");
        }
      } else {
        showToast(emailOk === false ? "Invite created. Email failed." : "Invite created.");
      }

      await loadAll();
    } finally {
      setInviteBusy(false);
    }
  }

  const seatText = useMemo(() => {
    if (!seats) return null;

    if (seats.limit == null) {
      return `${seats.used} seats used (unlimited plan)`;
    }

    const pendingMembers = Number(seats.pending_members ?? 0);
    const pendingInvites = Number(seats.pending_invites ?? 0);
    const reserved = Number(seats.reserved ?? pendingMembers + pendingInvites);

    return `${seats.used} / ${seats.limit} seats used (+${reserved} reserved)`;
  }, [seats]);

  const atCap = useMemo(() => {
    if (!seats) return false;
    if (seats.limit == null) return false;

    const pendingMembers = Number(seats.pending_members ?? 0);
    const pendingInvites = Number(seats.pending_invites ?? 0);
    const reserved = Number(seats.reserved ?? pendingMembers + pendingInvites);

    return seats.used + reserved >= seats.limit;
  }, [seats]);

  if (bootError) {
    return (
      <div className="space-y-6">
        <div className="rounded-[28px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex rounded-full border bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Team access
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Members</h1>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">
                Approve users, manage roles, control access, and keep seat usage clean.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/settings">Back to settings</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/app/billing">Billing</Link>
              </Button>
            </div>
          </div>
        </div>

        <Card className="overflow-hidden rounded-[28px] border shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-muted/40 px-6 py-4">
              <div className="text-sm font-semibold">Access restricted</div>
              <div className="mt-1 text-sm text-muted-foreground">{bootError}</div>
            </div>
            <div className="flex flex-wrap gap-3 p-6">
              <Button asChild className="rounded-full">
                <Link href="/app/settings">Go back</Link>
              </Button>
              <Button variant="outline" className="rounded-full" onClick={() => loadAll()}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex rounded-full border bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Team management
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Members</h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Invite teammates, approve access, manage roles, and stay on top of seat usage.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/settings">Back to settings</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/billing">Billing</Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatPill label="Your access" value={`${prettyRole(myRole)} • ${prettyStatus(myStatus)}`} />
          <StatPill label="Plan" value={plan || "Free"} />
          <StatPill label="Active members" value={String(activeCount)} />
          <StatPill label="Pending" value={`${pendingCount} members • ${invites.length} invites`} />
          <StatPill
            label="Seat usage"
            value={seatText || "—"}
            tone={atCap ? "danger" : "default"}
          />
        </div>
      </section>

      {toast ? (
        <Card className="overflow-hidden rounded-[28px] border shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-muted/40 px-6 py-4">
              <div className="text-sm font-semibold">Heads up</div>
              <div className="mt-1 text-sm text-muted-foreground">{toast}</div>
            </div>
            <div className="flex flex-wrap gap-3 p-6">
              <Button asChild className="rounded-full">
                <Link href="/app/billing">Upgrade in Billing</Link>
              </Button>
              <Button variant="outline" className="rounded-full" onClick={() => setToast("")}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-xl tracking-tight">Invite teammates</CardTitle>
                <CardDescription className="mt-2">
                  Create secure invite links and reserve seats before new members join.
                </CardDescription>
              </div>

              {atCap ? (
                <Badge variant="destructive" className="rounded-full px-3 py-1">
                  Seat cap reached
                </Badge>
              ) : (
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  {seatText || "Seats loading"}
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="rounded-3xl border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Invite by email…"
                  className="h-11 w-full rounded-2xl border bg-background px-4 text-sm outline-none ring-0 transition focus:border-foreground/20 focus:ring-2 focus:ring-ring"
                />
                <Button
                  className="h-11 rounded-full px-5"
                  disabled={!canCreateInvite || inviteBusy || !inviteEmail.trim()}
                  onClick={sendInvite}
                >
                  {inviteBusy ? "Sending..." : "Send invite"}
                </Button>
              </div>

              <div className="mt-3 text-xs text-muted-foreground">
                Owner and admins can invite users. Reserved seats include pending approvals and invite links.
              </div>
            </div>

            {!canCreateInvite ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                <div className="font-medium">Invites disabled</div>
                <div className="mt-1 text-amber-900/80 dark:text-amber-100/80">
                  Seat limit reached. Revoke pending invites or upgrade your plan before inviting more members.
                </div>
                <div className="mt-3">
                  <Button asChild size="sm" className="rounded-full">
                    <Link href="/app/billing">Upgrade</Link>
                  </Button>
                </div>
              </div>
            ) : null}

            {lastInviteLink ? (
              <div className="rounded-3xl border bg-background p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Latest invite link</div>
                    <div className="mt-2 overflow-x-auto rounded-2xl border bg-muted/30 p-3">
                      <code className="text-[11px] leading-5">{lastInviteLink}</code>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Invite links are only shown once when created. Copy it now if you need to send it manually.
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lastInviteLink);
                        showToast("Invite link copied.");
                      } catch {
                        showToast("Could not copy invite link.");
                      }
                    }}
                  >
                    Copy link
                  </Button>
                </div>

                {lastInviteEmailError ? (
                  <div className="mt-4 rounded-2xl border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/20 dark:text-yellow-100">
                    <div className="font-medium">Email failed to send</div>
                    <div className="mt-1">{lastInviteEmailError}</div>
                    <div className="mt-1 opacity-80">The invite link is still valid and can be shared manually.</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Pending invites</div>
                  <div className="text-xs text-muted-foreground">
                    Revoke unused invites to free reserved seats.
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {invites.length} open
                </Badge>
              </div>

              {invites.length === 0 ? (
                <div className="rounded-3xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
                  No pending invites right now.
                </div>
              ) : (
                <div className="space-y-3">
                  {invites.map((inv) => {
                    const busy = savingId === inv.id;

                    return (
                      <div
                        key={inv.id}
                        className="rounded-3xl border bg-background p-4 shadow-sm transition hover:shadow-md"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{inv.email}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>Created: {formatWhen(inv.created_at) || "—"}</span>
                              <span>•</span>
                              <span>Expires: {formatWhen(inv.expires_at) || "—"}</span>
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              For security, invite links are only shown once when created.
                            </div>
                          </div>

                          <Button
                            variant="destructive"
                            className="rounded-full"
                            disabled={!canManageMembers || busy}
                            onClick={() => revokeInvite(inv.id)}
                          >
                            {busy ? "Revoking..." : "Revoke"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl tracking-tight">Team snapshot</CardTitle>
            <CardDescription className="mt-2">
              Quick view of member status across your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border bg-background p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Active
                </div>
                <div className="mt-2 text-2xl font-semibold">{activeCount}</div>
              </div>
              <div className="rounded-3xl border bg-background p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Pending
                </div>
                <div className="mt-2 text-2xl font-semibold">{pendingCount}</div>
              </div>
              <div className="rounded-3xl border bg-background p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Blocked
                </div>
                <div className="mt-2 text-2xl font-semibold">{blockedCount}</div>
              </div>
            </div>

            <div className="rounded-3xl border bg-muted/30 p-4">
              <div className="text-sm font-semibold">Permissions</div>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <div>• Owner/Admin can invite, approve, block, and remove members.</div>
                <div>• Only the owner can transfer ownership.</div>
                <div>• Pending and invite seats still count toward plan limits.</div>
              </div>
            </div>

            <div className="rounded-3xl border bg-muted/30 p-4">
              <div className="text-sm font-semibold">Access rules</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Members cannot access app routes unless they pass{" "}
                <span className="font-medium text-foreground">requireActiveMember</span>.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[28px] border shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-xl tracking-tight">Member directory</CardTitle>
              <CardDescription className="mt-2">
                Search users, update access, and control roles from one place.
              </CardDescription>
            </div>

            <div className="w-full lg:w-80">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by email…"
                className="h-11 w-full rounded-2xl border bg-background px-4 text-sm outline-none ring-0 transition focus:border-foreground/20 focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {loading ? (
            <div className="rounded-3xl border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              Loading members…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              No members found.
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map((m) => {
                const status = normStatus(m.status);
                const role = normRole(m.role);
                const busy = savingId === m.id;

                const isMe = !!meUserId && m.id === meUserId;
                const isOwner = role === "owner";
                const isAdmin = role === "admin";

                const disableActivate = !canActivateAnotherMember && status !== "active";

                const canEditTarget =
                  canManageMembers && !isMe && !(myRole === "admin" && isOwner);

                const canRoleToggle = canEditTarget && !isOwner;
                const canStatusToggle = canEditTarget;

                const canRemove = canManageMembers && !isMe && !isOwner;

                return (
                  <div
                    key={m.id}
                    className="rounded-[28px] border bg-background p-5 shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-base font-semibold">{m.email}</div>
                          {isMe ? (
                            <Badge variant="secondary" className="rounded-full">
                              You
                            </Badge>
                          ) : null}
                          {m.email_verified ? (
                            <Badge variant="outline" className="rounded-full">
                              Verified
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="rounded-full">
                              Unverified
                            </Badge>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant={statusBadgeVariant(m.status)} className="rounded-full">
                            {prettyStatus(m.status)}
                          </Badge>
                          <Badge variant="outline" className="rounded-full">
                            {prettyRole(m.role)}
                          </Badge>
                        </div>

                        <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                          <div className="rounded-2xl border bg-muted/20 px-3 py-2">
                            Joined: {formatWhen(m.created_at) || "—"}
                          </div>
                          <div className="rounded-2xl border bg-muted/20 px-3 py-2">
                            Updated: {formatWhen(m.updated_at) || "—"}
                          </div>
                        </div>
                      </div>

                      <div className="flex w-full flex-col gap-4 xl:w-auto xl:min-w-[420px]">
                        <div className="rounded-3xl border bg-muted/20 p-3">
                          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Status
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <SegButton
                              active={status === "pending"}
                              disabled={busy || !canStatusToggle}
                              onClick={() => updateMember(m.id, "pending", role)}
                            >
                              Pending
                            </SegButton>
                            <SegButton
                              active={status === "active"}
                              disabled={busy || !canStatusToggle || disableActivate}
                              onClick={() => updateMember(m.id, "active", role)}
                            >
                              Active
                            </SegButton>
                            <SegButton
                              active={status === "blocked"}
                              disabled={busy || !canStatusToggle}
                              onClick={() => updateMember(m.id, "blocked", "member")}
                            >
                              Blocked
                            </SegButton>
                          </div>
                        </div>

                        <div className="rounded-3xl border bg-muted/20 p-3">
                          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Role & actions
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <SegButton
                              active={!isAdmin && !isOwner}
                              disabled={busy || !canRoleToggle}
                              onClick={() => updateMember(m.id, status, "member")}
                            >
                              Member
                            </SegButton>
                            <SegButton
                              active={isAdmin}
                              disabled={busy || !canRoleToggle || status !== "active"}
                              onClick={() => updateMember(m.id, "active", "admin")}
                            >
                              Admin
                            </SegButton>

                            <Button
                              variant="outline"
                              className="rounded-full"
                              disabled={
                                busy ||
                                !canTransferOwnership ||
                                isMe ||
                                status !== "active" ||
                                isOwner
                              }
                              onClick={() =>
                                showToast("Ownership transfer is not supported in this UI yet.")
                              }
                            >
                              Make owner
                            </Button>

                            <Button
                              variant="destructive"
                              className="rounded-full"
                              disabled={busy || !canRemove}
                              onClick={() => removeMember(m.id, m.email)}
                            >
                              {busy ? "Working..." : "Remove"}
                            </Button>
                          </div>
                        </div>

                        {!canActivateAnotherMember && status !== "active" ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                            Activation disabled: seat limit reached. Revoke invites or upgrade in{" "}
                            <Link className="underline" href="/app/billing">
                              Billing
                            </Link>
                            .
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}