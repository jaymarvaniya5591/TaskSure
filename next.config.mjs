/** @type {import('next').NextConfig} */
const nextConfig = {
    compress: true,
    output: 'standalone',
    poweredByHeader: false,
    experimental: {
        optimizePackageImports: [
            'lucide-react',
            'date-fns',
            '@tanstack/react-query',
            '@supabase/ssr',
            '@supabase/supabase-js',
        ],
    },
    compiler: {
        // Strip console.log (keep error/warn) in production for smaller output
        removeConsole: process.env.NODE_ENV === 'production'
            ? { exclude: ['error', 'warn'] }
            : false,
    },
    async headers() {
        return [
            {
                source: '/',
                headers: [{ key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' }],
            },
            {
                source: '/login',
                headers: [{ key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' }],
            },
            {
                source: '/signup',
                headers: [{ key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' }],
            },
            {
                // /auth/callback skeleton is pure HTML with zero user-specific content.
                // The token is in the query string and handled client-side by inline script.
                // s-maxage=30 lets Cloudflare cache and serve from Indian edge nodes (<50ms).
                source: '/auth/callback',
                headers: [{ key: 'Cache-Control', value: 'public, s-maxage=30, stale-while-revalidate=120' }],
            },
            {
                source: '/(.*)\\.svg',
                headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
            },
            {
                source: '/(.*)\\.ico',
                headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
            },
            {
                source: '/(.*)\\.woff2',
                headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
            },
        ];
    },
    async rewrites() {
        return [
            {
                source: '/supabase-proxy/:path*',
                destination: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/:path*`,
            },
        ];
    },
};
export default nextConfig;
