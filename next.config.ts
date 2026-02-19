import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },

  // ✅ Disable CSP here for now.
  // Your previous CSP (script-src 'self') breaks Next.js inline hydration scripts.
  // We'll enforce a Next-friendly CSP from proxy.ts instead.
  async headers() {
    return [];
  },
};

export default nextConfig;
