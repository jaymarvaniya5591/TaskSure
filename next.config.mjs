/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    poweredByHeader: false,
    // lamejs is loaded via fs.readFileSync at runtime — must be listed here so
    // Next.js traces it and copies it into the standalone node_modules output
    serverExternalPackages: ['lamejs'],
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
