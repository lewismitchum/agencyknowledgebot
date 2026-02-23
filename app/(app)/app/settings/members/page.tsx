// app/(app)/app/settings/members/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  pending_invites: number;
  limit: number | null;
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

function statusBadgeVariant(s: string | null): "secondary" | "outline" | "destructive" {
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

function SegButton(props: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className={[
        "rounded-full border px-3 py-1.5 text-xs",
        props.active ? "bg-accent text-foreground" : "bg-background text-muted-foreground hover:bg-accent",
        props.disabled ? "opacity-50 cursor-not-allowed hover:bg-background" : "",
      ].join(" ")}
      type="button"
    >
      {props.children}
    </button>
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

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);

  const [q, setQ] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  const [toast, setToast] = useState<string>("");

  const myRole = useMemo(() => normRole(meRole), [meRole]);
  const myStatus = useMemo(() => normStatus(meStatus), [meStatus]);

  const isOwnerOrAdmin = myRole === "owner" || myRole === "admin";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) => (m.email || "").toLowerCase().includes(needle));
  }, [members, q]);

  const seatsAtCap = useMemo(() => {
    if (!seats) return false;
    if (seats.limit == null) return false;
    return seats.used + seats.pending_invites >= seats.limit;
  }, [seats]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3500);
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

      setMeRole(role || null);
      setMeStatus(status || null);
      setMeUserId(id || null);

      const nRole = normRole(role || null);
      const nStatus = normStatus(status || null);

      // If pending/blocked, we don't even try to load members.
      if (nStatus !== "active") {
        setBootError(
          nStatus === "pending"
            ? "Your account is pending approval. You can’t manage members yet."
            : "Your account is blocked. You can’t manage members."
        );
        return;
      }

      // Owner/admin only
      if (!(nRole === "owner" || nRole === "admin")) {
        setBootError("Owner/Admin only. You don’t have permission to manage members.");
        return;
      }

      // NOTE: your API is currently owner-only (requireOwner). Admins will 403 until we update that route.
      const r = await fetch("/api/agency/users", { credentials: "include" });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (r.status === 403) {
        const j = await r.json().catch(() => null);
        setBootError(j?.error || "Forbidden");
        return;
      }
      if (!r.ok) {
        const raw = await r.text().catch(() => "");
        setBootError(raw || `Failed to load members (${r.status})`);
        return;
      }

      const j = await r.json().catch(() => null);
      setPlan(j?.plan ?? null);
      setSeats(j?.seats ?? null);
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
    user_id: string,
    status: "pending" | "active" | "blocked",
    role: "owner" | "member" | "admin"
  ) {
    setSavingId(user_id);
    try {
      const r = await fetch("/api/agency/users/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ user_id, status, role }),
      });

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        if (j?.error === "SEAT_LIMIT_EXCEEDED") {
          showToast("Seat limit reached for your plan. Upgrade in Billing to add more users.");
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

  async function revokeInvite(invite_id: string) {
    setSavingId(invite_id);
    try {
      const r = await fetch("/api/agency/invites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ invite_id }),
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

      await loadAll();
    } finally {
      setSavingId(null);
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    setInviteBusy(true);
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
        if (j?.error === "SEAT_LIMIT_EXCEEDED") {
          showToast("Seat limit reached for your plan. Upgrade in Billing to invite more users.");
          return;
        }
        alert(j?.error || `Invite failed (${r.status})`);
        return;
      }

      setInviteEmail("");
      await loadAll();
    } finally {
      setInviteBusy(false);
    }
  }

  const pendingBlockedMessage =
    myStatus === "pending"
      ? "Your account is pending approval. You can’t manage members yet."
      : myStatus === "blocked"
        ? "Your account is blocked. You can’t manage members."
        : null;

  const seatText = seats
    ? seats.limit == null
      ? `${seats.used} seats used (unlimited plan)`
      : `${seats.used} / ${seats.limit} seats used (+${seats.pending_invites} pending invites)`
    : null;

  // If bootError is set, we show only the error shell (no members UI).
  if (bootError) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
            <p className="mt-2 text-muted-foreground">Approve users, block access, manage roles, and track seats.</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/settings">Back to settings</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/settings/billing">Billing</Link>
            </Button>
          </div>
        </div>

        {pendingBlockedMessage ? (
          <div className="rounded-2xl border bg-muted p-4 text-sm">
            <div className="font-medium">Access restricted</div>
            <div className="mt-1 text-muted-foreground">{pendingBlockedMessage}</div>
          </div>
        ) : null}

        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Not allowed</div>
          <div className="mt-1 text-muted-foreground">{bootError}</div>
          <div className="mt-3 flex gap-2">
            <Button asChild className="rounded-full">
              <Link href="/app/settings">Go back</Link>
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => loadAll()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
          <p className="mt-2 text-muted-foreground">Approve users, block access, manage roles, and track seats.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/app/settings">Back to settings</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/app/settings/billing">Billing</Link>
          </Button>
        </div>
      </div>

      {toast ? (
        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Heads up</div>
          <div className="mt-1 text-muted-foreground">{toast}</div>
        </div>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Seats & Invites</CardTitle>
          <CardDescription>Plan enforcement is server-side. Pending invites count toward seats.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full">
                You: {myRole} / {myStatus}
              </Badge>
              {plan ? (
                <Badge variant="outline" className="rounded-full">
                  Plan: {plan}
                </Badge>
              ) : null}
              {seatText ? (
                <Badge variant="outline" className="rounded-full">
                  {seatText}
                </Badge>
              ) : null}
              {seatsAtCap ? (
                <Badge variant="destructive" className="rounded-full">
                  Seat cap reached
                </Badge>
              ) : null}
            </div>

            <div className="flex w-full flex-col gap-2 md:w-[420px] md:flex-row">
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Invite by email…"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                className="rounded-full"
                disabled={!isOwnerOrAdmin || inviteBusy || !inviteEmail.trim() || seatsAtCap}
                onClick={sendInvite}
              >
                Send invite
              </Button>
            </div>
          </div>

          {seatsAtCap ? (
            <div className="rounded-2xl border bg-muted p-3 text-sm">
              <div className="font-medium">You’re at your seat limit.</div>
              <div className="mt-1 text-muted-foreground">Revoke an invite, block a user, or upgrade your plan in Billing.</div>
            </div>
          ) : null}

          {invites.length ? (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="text-sm font-medium">Pending invites</div>
                <div className="space-y-2">
                  {invites.map((inv) => {
                    const busy = savingId === inv.id;
                    return (
                      <div
                        key={inv.id}
                        className="rounded-2xl border bg-background/40 p-4 md:flex md:items-center md:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="font-medium">{inv.email}</div>
                          <div className="text-xs text-muted-foreground">Expires: {formatWhen(inv.expires_at)}</div>
                        </div>
                        <div className="mt-3 flex gap-2 md:mt-0">
                          <Button
                            variant="destructive"
                            className="rounded-full"
                            disabled={!isOwnerOrAdmin || busy}
                            onClick={() => revokeInvite(inv.id)}
                          >
                            Revoke
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Directory</CardTitle>
          <CardDescription>Toggle status + role. Ownership transfer is a separate action.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="w-full md:w-80">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by email…"
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading members…</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground">No members found.</div>
            ) : (
              filtered.map((m) => {
                const status = normStatus(m.status);
                const role = normRole(m.role);
                const busy = savingId === m.id;

                const isMe = !!meUserId && m.id === meUserId;

                const disableActivate = seatsAtCap && status !== "active";

                const isOwner = role === "owner";
                const isAdmin = role === "admin";

                const canEdit = !isMe && isOwnerOrAdmin;
                const canRoleToggle = canEdit && !isOwner;
                const canStatusToggle = canEdit;

                return (
                  <div
                    key={m.id}
                    className="rounded-2xl border bg-background/40 p-4 md:flex md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{m.email}</div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant={statusBadgeVariant(m.status)} className="rounded-full">
                          {prettyStatus(m.status)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full">
                          {prettyRole(m.role)}
                        </Badge>
                        {isMe ? (
                          <Badge variant="secondary" className="rounded-full">
                            You
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 md:mt-0 md:items-end">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Status</span>
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

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Role</span>
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
                          disabled={busy || !isOwnerOrAdmin || isMe || status !== "active"}
                          onClick={() => updateMember(m.id, "active", "owner")}
                        >
                          Make owner
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-2 text-xs text-muted-foreground">
            Notes: Blocking forces the user out of app routes once you guard everything via{" "}
            <span className="font-medium">requireActiveMember</span>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}