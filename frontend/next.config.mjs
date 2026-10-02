/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Keep build concurrency low for the 1 vCPU / 1 GB frontend instance.
  experimental: { cpus: 1, webpackMemoryOptimizations: true },
  async rewrites() {
    // Local development only. Production routing belongs to frontend Nginx.
    return process.env.NODE_ENV === 'development'
      ? [{ source: '/api/:path*', destination: 'http://127.0.0.1:3001/api/:path*' }]
      : [];
  },
};
export default nextConfig;
