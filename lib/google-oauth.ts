// lib/google-oauth.ts
export const GOOGLE_PROVIDER = "google";

function getEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

export function getGoogleOAuthConfig() {
  const clientId = getEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = getEnv("GOOGLE_OAUTH_REDIRECT_URI");

  const scopes =
    getEnv("GOOGLE_OAUTH_SCOPES") ||
    [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ].join(" ");

  if (!clientId || !clientSecret || !redirectUri) {
    return { ok: false as const, clientId, clientSecret, redirectUri, scopes };
  }

  return { ok: true as const, clientId, clientSecret, redirectUri, scopes };
}

export function makeGoogleAuthUrl(state: string) {
  const cfg = getGoogleOAuthConfig();
  if (!cfg.ok) return null;

  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scopes);

  // critical for getting refresh_token
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");

  u.searchParams.set("state", state);

  return u.toString();
}

export async function exchangeGoogleCodeForTokens(code: string) {
  const cfg = getGoogleOAuthConfig();
  if (!cfg.ok) {
    return { ok: false as const, error: "MISSING_GOOGLE_OAUTH_ENV" };
  }

  const body = new URLSearchParams();
  body.set("code", code);
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("redirect_uri", cfg.redirectUri);
  body.set("grant_type", "authorization_code");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = await r.json().catch(() => null);

  if (!r.ok || !j) {
    return { ok: false as const, error: "TOKEN_EXCHANGE_FAILED", details: j };
  }

  return {
    ok: true as const,
    tokens: {
      access_token: String(j.access_token ?? ""),
      refresh_token: j.refresh_token ? String(j.refresh_token) : null,
      scope: String(j.scope ?? ""),
      expires_in: Number(j.expires_in ?? 0),
      id_token: j.id_token ? String(j.id_token) : null,
      token_type: String(j.token_type ?? ""),
    },
  };
}

export async function fetchGoogleUserEmail(accessToken: string) {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json().catch(() => null);
  const email = String(j?.email ?? "").trim();
  return email || null;
}