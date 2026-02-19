import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },

  async headers() {
    // Don’t apply CSP in development (it breaks Next dev tooling/hydration too easily)
    if (process.env.NODE_ENV !== "production") {
      return [];
    }

    // ✅ Production CSP (Next.js-friendly baseline)
    // NOTE: Next App Router commonly requires some inline scripts for hydration/streaming.
    // Tighten later using nonces/hashes once everything is stable.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // Allow inline/eval for Next hydration; remove 'unsafe-eval' later if you confirm it’s not needed.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval'",
      "script-src-attr 'self' 'unsafe-inline'",
      // Allow API calls from the browser
      "connect-src 'self' https://api.openai.com wss:",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
