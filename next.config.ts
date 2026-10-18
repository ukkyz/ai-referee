import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native Node.js addon and must not be bundled.
  serverExternalPackages: ['better-sqlite3'],
  // Allow the Arena preview proxy host to load Next.js dev resources.
  allowedDevOrigins: ['*.e2b.app'],
};

export default nextConfig;
