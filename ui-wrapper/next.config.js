/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  output: 'export',
  // Skip type checking in build (bun run typecheck covers it)
  typescript: { ignoreBuildErrors: true },
  // Skip ESLint in build (bun run lint covers it)
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ['zustand'],
  },
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
