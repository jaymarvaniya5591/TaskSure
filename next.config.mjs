/** @type {import('next').NextConfig} */
const nextConfig = {
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
