import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  // HSTS is added per request in src/proxy.ts (not here: these headers are fixed at build
  // time, and a single-computer installation must not pin HTTPS on localhost).
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2", "embedded-postgres"],
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
    // Tree-shake icon imports for smaller client bundles.
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Authenticated pages may contain personal data: never store them in shared or browser caches.
      { source: "/((?!_next/static|icons|manifest.webmanifest|sw.js|offline.html).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default withNextIntl(config);
