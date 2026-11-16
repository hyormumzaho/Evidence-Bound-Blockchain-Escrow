import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prefer built dist from workspace packages; transpile as a fallback for source.
  transpilePackages: ["@evidencebound/evidence", "@evidencebound/shared"],
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
