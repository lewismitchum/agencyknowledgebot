import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },

  // CSP that allows Cloudflare Turnstile.
  // If CSP is ALSO set elsewhere (middleware/proxy/vercel.json/Cloudflare),
  // that other CSP can override this and still block Turnstile.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
              "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
              "frame-src 'self' https://challenges.cloudflare.com",
              "connect-src 'self' https:",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;