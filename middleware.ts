// middleware.ts
import type { NextRequest } from "next/server";
import { proxy, config as proxyConfig } from "./proxy";

export const config = proxyConfig;

export function middleware(req: NextRequest) {
  return proxy(req);
}