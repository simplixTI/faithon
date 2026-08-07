/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deployed either at admin.faithon.ai (subdomain, no basePath)
  // or under /admin/* (set basePath: '/admin' if using single-project setup).
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
};
export default nextConfig;
