// app/(app)/app/settings/members/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className={[
        "rounded-full border px-3 py-1.5 text-xs",
        props.active
          ? "bg-accent text-foreground"
          : "bg-background text-muted-foreground hover:bg-accent",
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
    return members.filter((m) =>
      (m.email || "").toLowerCase().includes(needle)
    );
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
        setBootError(
          "Owner/Admin only. You don’t have permission to manage members."
        );
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
          setBootError(
            "Owner/Admin only. You don’t have permission to manage members."
          );
        } else if (code === "FORBIDDEN_NOT_ACTIVE") {
          setBootError(
            "Your account is pending approval. You can’t manage members yet."
          );
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
          showToast(
            emailOk === false ? "Invite created. Email failed." : "Invite created."
          );
        }
      } else {
        showToast(
          emailOk === false ? "Invite created. Email failed." : "Invite created."
        );
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
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
            <p className="mt-2 text-muted-foreground">
              Approve users, block access, manage roles, and track seats.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/settings">Back to settings</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/app/billing">Billing</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Not allowed</div>
          <div className="mt-1 text-muted-foreground">{bootError}</div>
          <div className="mt-3 flex gap-2">
            <Button asChild className="rounded-full">
              <Link href="/app/settings">Go back</Link>
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => loadAll()}
            >
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
          <p className="mt-2 text-muted-foreground">
            Approve users, block access, manage roles, and track seats.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/app/settings">Back to settings</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/app/billing">Billing</Link>
          </Button>
        </div>
      </div>

      {toast ? (
        <div className="rounded-2xl border bg-muted p-4 text-sm">
          <div className="font-medium">Heads up</div>
          <div className="mt-1 text-muted-foreground">{toast}</div>
          <div className="mt-3 flex gap-2">
            <Button asChild className="rounded-full">
              <Link href="/app/billing">Upgrade in Billing</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">Seats & Invites</CardTitle>
          <CardDescription>
            Plan enforcement is server-side. Reserved = pending members + pending
            invites.
          </CardDescription>
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
              {atCap ? (
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
                disabled={!canCreateInvite || inviteBusy || !inviteEmail.trim()}
                onClick={sendInvite}
              >
                Send invite
              </Button>
            </div>
          </div>

          {!canCreateInvite ? (
            <div className="rounded-2xl border bg-background/40 p-3 text-xs text-muted-foreground">
              Invites disabled: seat limit reached. Revoke pending invites or
              upgrade in Billing.
              <div className="mt-2">
                <Button asChild size="sm" className="rounded-full">
                  <Link href="/app/billing">Upgrade</Link>
                </Button>
              </div>
            </div>
          ) : null}

          {lastInviteLink ? (
            <div className="rounded-2xl border bg-background/40 p-3 text-xs">
              <div className="font-medium">Last invite link</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border bg-background px-2 py-1 text-[11px]">
                  {lastInviteLink}
                </code>
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
                  Copy
                </Button>
              </div>

              {lastInviteEmailError ? (
                <div className="mt-2 rounded-xl border border-yellow-200 bg-yellow-50 p-2 text-[11px] text-yellow-900">
                  <div className="font-medium">Email failed to send</div>
                  <div className="mt-1">{lastInviteEmailError}</div>
                  <div className="mt-1 text-yellow-800/80">
                    Link is still valid — paste it manually.
                  </div>
                </div>
              ) : null}

              <div className="mt-1 text-muted-foreground">
                (Tip: invite links aren’t shown later — copy it when created.)
              </div>
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
                          <div className="text-xs text-muted-foreground">
                            Expires: {formatWhen(inv.expires_at)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            For security, invite links are only shown once (when
                            created).
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2 md:mt-0">
                          <Button
                            variant="destructive"
                            className="rounded-full"
                            disabled={!canManageMembers || busy}
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
          <CardDescription>
            Admins can manage members. Only owner can transfer ownership.
          </CardDescription>
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
              <div className="text-sm text-muted-foreground">
                Loading members…
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No members found.
              </div>
            ) : (
              filtered.map((m) => {
                const status = normStatus(m.status);
                const role = normRole(m.role);
                const busy = savingId === m.id;

                const isMe = !!meUserId && m.id === meUserId;
                const isOwner = role === "owner";
                const isAdmin = role === "admin";

                const disableActivate =
                  !canActivateAnotherMember && status !== "active";

                const canEditTarget =
                  canManageMembers && !isMe && !(myRole === "admin" && isOwner);

                const canRoleToggle = canEditTarget && !isOwner;
                const canStatusToggle = canEditTarget;

                const canRemove = canManageMembers && !isMe && !isOwner;

                return (
                  <div
                    key={m.id}
                    className="rounded-2xl border bg-background/40 p-4 md:flex md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{m.email}</div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge
                          variant={statusBadgeVariant(m.status)}
                          className="rounded-full"
                        >
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
                        <span className="text-xs text-muted-foreground">
                          Status
                        </span>
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
                        <span className="text-xs text-muted-foreground">
                          Role
                        </span>
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
                            showToast(
                              "Ownership transfer is not supported in this UI yet."
                            )
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
                          Remove
                        </Button>
                      </div>

                      {!canActivateAnotherMember && status !== "active" ? (
                        <div className="text-xs text-muted-foreground">
                          Activation disabled: seat limit reached. Revoke invites
                          or upgrade.
                          <span className="ml-2">
                            <Link className="underline" href="/app/billing">
                              Billing
                            </Link>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-2 text-xs text-muted-foreground">
            Notes: Members can’t access app routes unless they pass{" "}
            <span className="font-medium">requireActiveMember</span>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}