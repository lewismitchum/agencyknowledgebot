// lib/fetch-json.ts
export type FetchJsonError = Error & {
  status?: number;
  code?: string;
  body?: any;
};

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);

  let body: any = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const err: FetchJsonError = new Error(
      (body && typeof body === "object" && (body.error || body.message)) ? (body.error || body.message) : `HTTP_${res.status}`
    ) as FetchJsonError;

    err.status = res.status;
    err.code =
      body && typeof body === "object"
        ? String(body.code || body.error || body.reason || "")
        : "";
    err.body = body;

    throw err;
  }

  return body as T;
}