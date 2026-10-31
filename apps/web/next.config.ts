import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone for our own origin (voice prompt); camera only for Persona identity checks; location never.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(self \"https://withpersona.com\" \"https://inquiry.withpersona.com\" \"https://*.withpersona.com\"), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // A baseline content policy that can't break the map, voice or identity check: no plugins, no
  // <base> hijacking, forms only post to us, the site can't be framed, and everything loads over HTTPS.
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests" },
  // Sign-in and identity pop-ups keep working; other windows can't reach into ours.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The engine is shipped as TypeScript source inside the monorepo.
  transpilePackages: ["@backline/engine"],
  poweredByHeader: false,
  // The waitlist became sign-in; old /join links land on it.
  async redirects() {
    return [{ source: "/join", destination: "/signin", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
