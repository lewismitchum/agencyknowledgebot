// lib/gmail.ts
import { getGoogleOAuthConfig } from "@/lib/google-oauth";

type TokenSet = {
  access_token: string;
  expires_at: string | null; // ISO
  scope?: string | null;
};

function nowMs() {
  return Date.now();
}

function parseTimeMs(iso: string | null | undefined) {
  if (!iso) return 0;
  const t = new Date(String(iso)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isExpiringSoon(expiresAtIso: string | null | undefined, skewMs = 90_000) {
  const t = parseTimeMs(expiresAtIso);
  if (!t) return true;
  return t - nowMs() <= skewMs;
}

function isoPlusSeconds(seconds: number) {
  const ms = Math.max(0, Math.floor(seconds || 0)) * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const cfg = getGoogleOAuthConfig();
  if (!cfg.ok) return { ok: false as const, error: "MISSING_GOOGLE_OAUTH_ENV" };

  const body = new URLSearchParams();
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const r = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = await r.json().catch(() => null);

  if (!r.ok || !j?.access_token) {
    return { ok: false as const, error: "REFRESH_FAILED", details: j };
  }

  return {
    ok: true as const,
    tokens: {
      access_token: String(j.access_token),
      expires_at: isoPlusSeconds(Number(j.expires_in ?? 0)),
      scope: j.scope ? String(j.scope) : null,
    } satisfies TokenSet,
  };
}

export async function ensureFreshAccessToken(args: {
  access_token: string | null;
  token_expires_at: string | null;
  refresh_token: string | null;
  onUpdate: (t: { access_token: string; token_expires_at: string | null; scope?: string | null }) => Promise<void>;
}) {
  const access = String(args.access_token ?? "").trim();
  const refresh = String(args.refresh_token ?? "").trim();

  if (access && !isExpiringSoon(args.token_expires_at)) {
    return { ok: true as const, access_token: access };
  }

  if (!refresh) return { ok: false as const, error: "NO_REFRESH_TOKEN" };

  const ref = await refreshGoogleAccessToken(refresh);
  if (!ref.ok) return ref;

  await args.onUpdate({
    access_token: ref.tokens.access_token,
    token_expires_at: ref.tokens.expires_at,
    scope: ref.tokens.scope ?? null,
  });

  return { ok: true as const, access_token: ref.tokens.access_token };
}

async function gmailfetchJson(path: string, accessToken: string) {
  const r = await fetchJson(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: j };
}

export async function listThreads(accessToken: string, maxResults = 20) {
  const n = Math.max(1, Math.min(50, Math.floor(maxResults || 20)));
  const q = new URLSearchParams();
  q.set("maxResults", String(n));
  q.set("includeSpamTrash", "false");

  const res = await gmailfetchJson(`users/me/threads?${q.toString()}`, accessToken);
  if (!res.ok) return { ok: false as const, error: "GMAIL_LIST_THREADS_FAILED", details: res.json, status: res.status };

  const threads = Array.isArray(res.json?.threads) ? res.json.threads : [];
  const ids = threads.map((t: any) => String(t?.id || "")).filter(Boolean);

  return { ok: true as const, thread_ids: ids };
}

function headerValue(headers: any[], name: string) {
  const h = (headers || []).find((x: any) => String(x?.name || "").toLowerCase() === name.toLowerCase());
  return h?.value ? String(h.value) : "";
}

export async function getThread(accessToken: string, threadId: string) {
  const id = String(threadId || "").trim();
  if (!id) return { ok: false as const, error: "MISSING_THREAD_ID" };

  // format=metadata is cheap; add headers we care about
  const q = new URLSearchParams();
  q.set("format", "metadata");
  q.set("metadataHeaders", "From");
  q.set("metadataHeaders", "To");
  q.set("metadataHeaders", "Subject");
  q.set("metadataHeaders", "Date");

  const res = await gmailfetchJson(`users/me/threads/${encodeURIComponent(id)}?${q.toString()}`, accessToken);
  if (!res.ok) return { ok: false as const, error: "GMAIL_GET_THREAD_FAILED", details: res.json, status: res.status };

  const msgs = Array.isArray(res.json?.messages) ? res.json.messages : [];

  const mapped: {
    id: string;
    internalDate: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    snippet: string;
  }[] = msgs.slice(0, 30).map((m: any) => {
    const headers = Array.isArray(m?.payload?.headers) ? m.payload.headers : [];
    return {
      id: String(m?.id || ""),
      internalDate: String(m?.internalDate || ""),
      from: headerValue(headers, "From"),
      to: headerValue(headers, "To"),
      subject: headerValue(headers, "Subject"),
      date: headerValue(headers, "Date"),
      snippet: String(m?.snippet || ""),
    };
  });

  const subject = mapped.find((x) => x.subject)?.subject || "(no subject)";
  const last = mapped[mapped.length - 1];

  return {
    ok: true as const,
    thread: {
      id,
      subject,
      last_from: last?.from || "",
      last_snippet: last?.snippet || "",
      messages: mapped,
    },
  };
}