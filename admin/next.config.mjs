/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Served at faithon.ai/admin/* via a rewrite from the main Vercel
  // project. basePath makes all internal routes, assets, and Link
  // hrefs live under /admin so the rewrite is transparent.
  basePath: "/admin",
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
};
export default nextConfig;
