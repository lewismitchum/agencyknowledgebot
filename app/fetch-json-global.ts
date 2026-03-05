// app/fetch-json-global.ts
// Defines a global fetchJson() helper so older client pages compile without per-file imports.

export {};

declare global {
  // eslint-disable-next-line no-var
  var fetchJson: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

if (typeof globalThis.fetchJson !== "function") {
  globalThis.fetchJson = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    if (!headers.has("accept")) headers.set("accept", "application/json");

    return fetch(input, {
      ...init,
      headers,
    });
  };
}