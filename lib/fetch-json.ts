// lib/fetch-json.ts
//
// Small fetch wrapper that automatically sends the user's IANA timezone
// on every request via: X-User-Timezone
//
// Usage:
//   const data = await fetchJson<MyType>("/api/me");
//   await fetchJson("/api/something", { method: "POST", body: JSON.stringify(payload) });
//
// Notes:
// - Defaults to `credentials: "include"` so your cookie auth works.
// - Does NOT force Content-Type (so it won't break FormData uploads).
// - Throws a helpful Error on non-2xx responses (includes status + response body).
//
// IMPORTANT COMPAT:
// Some client pages check `e.status` directly.
// This class exposes BOTH:
//   - e.status (number)  ✅
//   - e.info.status (number) ✅

export type FetchJsonErrorInfo = {
  status: number;
  statusText: string;
  url?: string;
  bodyText?: string;
};

export class FetchJsonError extends Error {
  info: FetchJsonErrorInfo;

  // Convenience fields (for app code that expects them)
  status: number;
  code?: string;
  body?: any;

  constructor(message: string, info: FetchJsonErrorInfo, body?: any, code?: string) {
    super(message);
    this.name = "FetchJsonError";
    this.info = info;

    // Back-compat: allow `e.status`
    this.status = info.status;
    this.body = body;
    this.code = code;
  }
}

function getUserTimezoneSafe(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

function mergeHeaders(a?: HeadersInit, b?: HeadersInit): Headers {
  const h = new Headers(a || undefined);
  if (b) {
    const hb = new Headers(b);
    hb.forEach((value, key) => h.set(key, value));
  }
  return h;
}

async function readBodyTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function tryParseJson(text: string): any | null {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export async function fetchJson<T = any>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const tz = getUserTimezoneSafe();

  const headers = mergeHeaders(init.headers, {
    Accept: "application/json",
  });

  // Only set if not already set by caller.
  if (tz && !headers.has("X-User-Timezone")) {
    headers.set("X-User-Timezone", tz);
  }

  // Important: don't set Content-Type here (would break FormData).
  const res = await fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });

  if (!res.ok) {
    const bodyText = await readBodyTextSafe(res);
    const bodyJson = tryParseJson(bodyText);

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : undefined;

    const codeRaw =
      bodyJson && typeof bodyJson === "object"
        ? bodyJson.code || bodyJson.error_code || bodyJson.error
        : undefined;

    const code = codeRaw == null ? undefined : String(codeRaw);

    const msgRaw =
      bodyJson && typeof bodyJson === "object"
        ? bodyJson.message || bodyJson.error
        : undefined;

    const message =
      msgRaw != null && String(msgRaw).trim().length
        ? String(msgRaw)
        : `Request failed (${res.status} ${res.statusText})`;

    throw new FetchJsonError(
      message,
      {
        status: res.status,
        statusText: res.statusText,
        url,
        bodyText,
      },
      bodyJson ?? (bodyText || undefined),
      code
    );
  }

  // Handle 204 No Content / empty body safely
  if (res.status === 204) return undefined as any;

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }

  // Fallback: if server returns non-json text, return it (typed as any).
  return (await res.text()) as any as T;
}