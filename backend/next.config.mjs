/**
 * Next.js configuration for Bemz Africa Marketplace.
 *
 * Two jobs only: let `next/image` serve Cloudinary assets (and the placeholder host the seed
 * data uses in local development), and put the cheap security headers on every response
 * including the API, so a misconfigured route cannot be the reason a buyer's session cookie is
 * readable from another origin.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },

  async headers() {
    const production = process.env.NODE_ENV === 'production';

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'x-frame-options', value: 'DENY' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'permissions-policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(self)',
          },
          ...(production
            ? [
                {
                  key: 'strict-transport-security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
      {
        // Checkout carries a mobile money number; keep it out of any cache a shared
        // device's browser might leave behind. The API sets its own cache headers per route.
        source: '/api/:path*',
        headers: [{ key: 'x-robots-tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
