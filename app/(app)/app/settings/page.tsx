"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Settings,
  User,
  Brain,
  Save,
  RefreshCw,
  Trash2,
  Mail,
  Building2,
  Clock3,
  Shield,
  KeyRound,
  AlertTriangle,
} from "lucide-react";

type MemoryRow = {
  id: string;
  scope: string;
  bot_id: string;
  content: string;
  last_used_at: string;
  last_updated_at: string;
  created_at: string;
};

type SettingsPayload = {
  ok: boolean;
  account: {
    user_id: string;
    agency_id: string;
    email: string | null;
    display_name: string;
    timezone: string;
    plan: string;
    password_supported?: boolean;
  };
  memories: MemoryRow[];
};

function Card({
  title,
  icon,
  subtitle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="border-b p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl border p-2">{icon}</div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  const tone =
    scope === "system"
      ? "bg-slate-100 text-slate-700"
      : scope === "agency"
      ? "bg-blue-100 text-blue-700"
      : "bg-emerald-100 text-emerald-700";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {scope}
    </span>
  );
}

function formatDate(value: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [savingMemoryId, setSavingMemoryId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [account, setAccount] = useState({
    user_id: "",
    agency_id: "",
    email: "",
    display_name: "",
    timezone: "",
    plan: "",
    password_supported: false,
  });

  const [emailForm, setEmailForm] = useState({
    email: "",
  });

  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  const [deleteConfirm, setDeleteConfirm] = useState("");

  const [memories, setMemories] = useState<MemoryRow[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings/account-memory", {
        method: "GET",
        cache: "no-store",
      });

      const data = (await res.json()) as SettingsPayload | { error?: string; message?: string };

      if (!res.ok || !("ok" in data)) {
        throw new Error(String((data as any)?.message || (data as any)?.error || "Failed to load settings"));
      }

      const nextAccount = {
        user_id: data.account.user_id || "",
        agency_id: data.account.agency_id || "",
        email: data.account.email || "",
        display_name: data.account.display_name || "",
        timezone: data.account.timezone || "",
        plan: data.account.plan || "",
        password_supported: !!data.account.password_supported,
      };

      setAccount(nextAccount);
      setEmailForm({ email: nextAccount.email || "" });
      setMemories(Array.isArray(data.memories) ? data.memories : []);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load settings"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const memoryStats = useMemo(() => {
    return {
      total: memories.length,
      agency: memories.filter((m) => m.scope === "agency").length,
      user: memories.filter((m) => m.scope === "user").length,
      system: memories.filter((m) => m.scope === "system").length,
    };
  }, [memories]);

  function clearBanners() {
    setMessage("");
    setError("");
  }

  async function saveAccount() {
    setSavingAccount(true);
    clearBanners();

    try {
      const res = await fetch("/api/settings/account-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_account",
          display_name: account.display_name,
          timezone: account.timezone,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(String(data?.message || data?.error || "Failed to save account"));
      }

      setMessage("Account settings saved.");
      await load();
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to save account"));
    } finally {
      setSavingAccount(false);
    }
  }

  async function changeEmail() {
    setSavingEmail(true);
    clearBanners();

    try {
      const res = await fetch("/api/settings/account-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_email",
          email: emailForm.email,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(String(data?.message || data?.error || "Failed to change email"));
      }

      setMessage("Email updated.");
      await load();
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to change email"));
    } finally {
      setSavingEmail(false);
    }
  }

  async function changePassword() {
    setSavingPassword(true);
    clearBanners();

    try {
      if (passwordForm.new_password !== passwordForm.confirm_password) {
        throw new Error("New password and confirm password do not match");
      }

      const res = await fetch("/api/settings/account-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(String(data?.message || data?.error || "Failed to change password"));
      }

      setPasswordForm({
        current_password: "",
        new_password: "",
        confirm_password: "",
      });

      setMessage("Password updated.");
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to change password"));
    } finally {
      setSavingPassword(false);
    }
  }

  async function deleteAccount() {
    setDeletingAccount(true);
    clearBanners();

    try {
      const res = await fetch("/api/settings/account-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_account",
          confirm_text: deleteConfirm,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(String(data?.message || data?.error || "Failed to delete account"));
      }

      window.location.href = "/login";
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to delete account"));
    } finally {
      setDeletingAccount(false);
    }
  }

  async function saveMemory(memoryId: string, content: string) {
    setSavingMemoryId(memoryId);
    clearBanners();

    try {
      const res = await fetch("/api/settings/account-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_memory",
          memory_id: memoryId,
          content,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(String(data?.message || data?.error || "Failed to save memory"));
      }

      setMessage("Memory updated.");
      await load();
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to save memory"));
    } finally {
      setSavingMemoryId("");
    }
  }

  async function clearMemory(memoryId: string) {
    setSavingMemoryId(memoryId);
    clearBanners();

    try {
      const res = await fetch("/api/settings/account-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear_memory",
          memory_id: memoryId,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(String(data?.message || data?.error || "Failed to clear memory"));
      }

      setMessage("Memory cleared.");
      await load();
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to clear memory"));
    } finally {
      setSavingMemoryId("");
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-slate-600">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 rounded-3xl border bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border bg-white p-3">
            <Settings className="h-6 w-6 text-slate-700" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
            <p className="text-sm text-slate-500">Account controls and live bot memory review.</p>
          </div>
        </div>

        {message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card
          title="Account"
          icon={<User className="h-5 w-5 text-slate-700" />}
          subtitle="Basic account info for the logged-in user."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Display name</label>
              <input
                value={account.display_name}
                onChange={(e) => setAccount((prev) => ({ ...prev, display_name: e.target.value }))}
                placeholder="Your name"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Timezone</label>
              <input
                value={account.timezone}
                onChange={(e) => setAccount((prev) => ({ ...prev, timezone: e.target.value }))}
                placeholder="America/Chicago"
                className="w-full rounded-2xl border px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Email</label>
              <div className="flex items-center gap-2 rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <Mail className="h-4 w-4" />
                <span>{account.email || "—"}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Plan</label>
              <div className="flex items-center gap-2 rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <Shield className="h-4 w-4" />
                <span className="capitalize">{account.plan || "free"}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Agency ID</label>
              <div className="flex items-center gap-2 rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <Building2 className="h-4 w-4" />
                <span className="truncate">{account.agency_id || "—"}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">User ID</label>
              <div className="flex items-center gap-2 rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <Clock3 className="h-4 w-4" />
                <span className="truncate">{account.user_id || "—"}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={saveAccount}
              disabled={savingAccount}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {savingAccount ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save account
            </button>
          </div>
        </Card>

        <Card
          title="Memory overview"
          icon={<Brain className="h-5 w-5 text-slate-700" />}
          subtitle="Inspect what the bot is actually keeping."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{memoryStats.total}</div>
            </div>
            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">System</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{memoryStats.system}</div>
            </div>
            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Agency</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{memoryStats.agency}</div>
            </div>
            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">User</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{memoryStats.user}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Change email"
          icon={<Mail className="h-5 w-5 text-slate-700" />}
          subtitle="Update the email used on this account."
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">New email</label>
            <input
              value={emailForm.email}
              onChange={(e) => setEmailForm({ email: e.target.value })}
              placeholder="you@example.com"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400"
            />
          </div>

          <div className="mt-4">
            <button
              onClick={changeEmail}
              disabled={savingEmail}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {savingEmail ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save email
            </button>
          </div>
        </Card>

        <Card
          title="Change password"
          icon={<KeyRound className="h-5 w-5 text-slate-700" />}
          subtitle={
            account.password_supported
              ? "Update your password."
              : "This account setup does not currently support password change from settings."
          }
        >
          <div className="space-y-3">
            <input
              type="password"
              value={passwordForm.current_password}
              onChange={(e) => setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))}
              placeholder="Current password"
              disabled={!account.password_supported}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400 disabled:bg-slate-50"
            />
            <input
              type="password"
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))}
              placeholder="New password"
              disabled={!account.password_supported}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400 disabled:bg-slate-50"
            />
            <input
              type="password"
              value={passwordForm.confirm_password}
              onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
              placeholder="Confirm new password"
              disabled={!account.password_supported}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400 disabled:bg-slate-50"
            />
          </div>

          <div className="mt-4">
            <button
              onClick={changePassword}
              disabled={savingPassword || !account.password_supported}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {savingPassword ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save password
            </button>
          </div>
        </Card>

        <Card
          title="Delete account"
          icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
          subtitle="This deletes the current user account and attempts to remove user-owned data."
        >
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Type <span className="font-semibold">DELETE</span> to confirm.
          </div>

          <div className="mt-3">
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none ring-0 transition focus:border-red-300"
            />
          </div>

          <div className="mt-4">
            <button
              onClick={deleteAccount}
              disabled={deletingAccount}
              className="inline-flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {deletingAccount ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete account
            </button>
          </div>
        </Card>
      </div>

      <Card
        title="Bot memory"
        icon={<Brain className="h-5 w-5 text-slate-700" />}
        subtitle="System memory is locked. Agency and user memory can be reviewed and edited here."
      >
        <div className="space-y-5">
          {memories.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-6 text-sm text-slate-500">
              No memory rows found yet.
            </div>
          ) : null}

          {memories.map((memory, index) => {
            const locked = memory.scope === "system";

            return (
              <MemoryEditor
                key={memory.id || `${memory.scope}-${index}`}
                memory={memory}
                locked={locked}
                busy={savingMemoryId === memory.id}
                onSave={saveMemory}
                onClear={clearMemory}
              />
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function MemoryEditor({
  memory,
  locked,
  busy,
  onSave,
  onClear,
}: {
  memory: MemoryRow;
  locked: boolean;
  busy: boolean;
  onSave: (memoryId: string, content: string) => Promise<void>;
  onClear: (memoryId: string) => Promise<void>;
}) {
  const [value, setValue] = useState(memory.content || "");

  useEffect(() => {
    setValue(memory.content || "");
  }, [memory.content]);

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ScopeBadge scope={memory.scope} />
          {memory.bot_id ? (
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              bot: {memory.bot_id}
            </span>
          ) : null}
          {locked ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
              locked
            </span>
          ) : null}
        </div>

        <div className="text-xs text-slate-500">
          updated {formatDate(memory.last_updated_at)} · used {formatDate(memory.last_used_at)}
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={locked || busy}
        className="min-h-[220px] w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-50"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">{value.length.toLocaleString()} chars</div>

        <div className="flex flex-wrap gap-2">
          {!locked ? (
            <>
              <button
                onClick={() => onClear(memory.id)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Clear
              </button>

              <button
                onClick={() => onSave(memory.id, value)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save memory
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}