// types/fetch-json.d.ts
export {};

declare global {
  // eslint-disable-next-line no-var
  var fetchJson: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}