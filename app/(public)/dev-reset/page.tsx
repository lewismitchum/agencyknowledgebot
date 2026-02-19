"use client";

import React, { useState } from "react";

export default function DevResetPage() {
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("lewismitchum1@gmail.com");
  const [newPassword, setNewPassword] = useState("");
  const [oldEmail, setOldEmail] = useState("lewismitchum1@gmail.com");
  const [targetEmail, setTargetEmail] = useState("lewismitchum7@gmail.com");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [note, setNote] = useState("");

  async function callApi(method: "POST" | "PUT" | "PATCH") {
    const s = secret.trim();
    if (!s) {
      setNote("Fill in DEV_ADMIN_SECRET first.");
      return;
    }

    setNote("");
    setLoading(true);
    setResult("");

    try {
      const body =
        method === "POST"
          ? { email: email.trim().toLowerCase(), newPassword }
          : method === "PATCH"
          ? { oldEmail: oldEmail.trim().toLowerCase(), newEmail: targetEmail.trim().toLowerCase() }
          : undefined;

      if (method === "POST") {
        if (!body?.email || !newPassword.trim()) {
          setNote("Fill in email + new password.");
          setLoading(false);
          return;
        }
      }

      if (method === "PATCH") {
        if (!oldEmail.trim() || !targetEmail.trim()) {
          setNote("Fill in oldEmail + newEmail.");
          setLoading(false);
          return;
        }
      }

      const res = await fetch("/api/dev/reset-password", {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-dev-admin-secret": s,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await res.text();
      setResult(`HTTP ${res.status}\n${text}`);
    } catch (err: any) {
      setResult(`ERROR\n${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Dev Password Reset / Email Rename</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>Temporary page. Delete after use.</p>

      <div style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>DEV_ADMIN_SECRET</span>
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="paste DEV_ADMIN_SECRET"
            style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => callApi("PUT")}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              border: "1px solid #111",
              background: loading ? "#666" : "#111",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Loading..." : "List agencies (debug)"}
          </button>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "8px 0" }} />

        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Rename agency email</h2>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Old email (current in DB)</span>
          <input
            value={oldEmail}
            onChange={(e) => setOldEmail(e.target.value)}
            style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>New email (what you want)</span>
          <input
            value={targetEmail}
            onChange={(e) => setTargetEmail(e.target.value)}
            style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}
          />
        </label>

        <button
          type="button"
          onClick={() => callApi("PATCH")}
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 999,
            border: "1px solid #111",
            background: loading ? "#666" : "#111",
            color: "#fff",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Renaming..." : "Rename email"}
        </button>

        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "8px 0" }} />

        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reset password (by agency email)</h2>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>New Password</span>
          <input
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            type="password"
            placeholder="new password"
            style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}
          />
        </label>

        <button
          type="button"
          onClick={() => callApi("POST")}
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 999,
            border: "1px solid #111",
            background: loading ? "#666" : "#111",
            color: "#fff",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Resetting..." : "Reset password"}
        </button>

        {note ? <div style={{ color: "#b00", fontSize: 13 }}>{note}</div> : null}

        {result ? (
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              borderRadius: 12,
              background: "#f6f6f6",
              border: "1px solid #e5e5e5",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {result}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
