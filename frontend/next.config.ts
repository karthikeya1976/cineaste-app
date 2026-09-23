import type { NextConfig } from "next";

// Proxy all /api/backend/* requests to the FastAPI backend.
// - On Vercel (production): → https://redactor-api.duckdns.org
// - Locally:                → http://localhost:8088
// This means the browser always calls its own origin, eliminating mixed-content blocks.
const BACKEND =
  process.env.VERCEL
    ? "https://redactor-api.duckdns.org"
    : (process.env.BACKEND_URL ?? "http://localhost:8088");

// Proxy all /api/gatekept/* requests to Gatekept's backend.
// - On Vercel (production): → https://redactor-api.duckdns.org/gatekept
//   (Nginx on the shared EC2 box strips the /gatekept prefix before proxying
//   to Gatekept's Express app, which has no path prefix of its own.)
// - Locally:                → http://localhost:4000
//   (Gatekept's own default dev port, distinct from Misence's :8088;
//   no /gatekept segment since there's no Nginx in front locally.)
const GATEKEPT_BACKEND =
  process.env.VERCEL
    ? "https://redactor-api.duckdns.org/gatekept"
    : (process.env.GATEKEPT_BACKEND_URL ?? "http://localhost:4000");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${BACKEND}/:path*`,
      },
      {
        source: "/api/gatekept/:path*",
        destination: `${GATEKEPT_BACKEND}/:path*`,
      },
    ];
  },
};

export default nextConfig;
