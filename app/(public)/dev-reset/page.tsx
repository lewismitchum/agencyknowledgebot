"use client";

import React, { useState } from "react";

export default function DevResetPage() {
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("lewismitchum7@gmail.com");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [note, setNote] = useState("");

  async function runReset() {
    const s = secret.trim();
    const e = email.trim().toLowerCase();
    const p = newPassword;

    if (!s || !e || !p) {
      setNote("Fill in DEV_ADMIN_SECRET, email, and new password.");
      return;
    }

    setNote("");
    setLoading(true);
    setResult("");

    try {
      const res = await fetch("/api/dev/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-dev-admin-secret": s,
        },
        body: JSON.stringify({ email: e, newPassword: p }),
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
    <main
      style={{
        maxWidth: 560,
        margin: "40px auto",
        padding: 16,
        fontFamily: "ui-sans-serif, system-ui",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        Dev Password Reset
      </h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        Temporary page. Delete after use.
      </p>

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
          onClick={runReset}
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
          {loading ? "Resetting..." : "Reset Password"}
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
